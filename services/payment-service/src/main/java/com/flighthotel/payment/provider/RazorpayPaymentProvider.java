package com.flighthotel.payment.provider;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Razorpay (test or live mode, decided by the keys). Plain HTTPS calls to the REST API with Basic authentication;
 * no SDK, so every call is visible and testable. Amounts are rupees outside and paise inside this class only.
 * <p>
 * Secrets never appear in logs or error messages. The Key ID is public (the browser needs it), the Key Secret and
 * the webhook secret stay on the server.
 */
public class RazorpayPaymentProvider implements PaymentProvider {

    public static final String CODE = "RAZORPAY";
    private static final Logger log = LoggerFactory.getLogger(RazorpayPaymentProvider.class);
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private final String keyId;
    private final String keySecret;
    private final String webhookSecret;
    private final String apiUrl;
    private final Duration timeout;
    private final HttpClient http;
    private final JsonMapper json;
    private final String authorization;

    public RazorpayPaymentProvider(String keyId, String keySecret, String webhookSecret, String apiUrl,
            Duration timeout, JsonMapper json) {
        if (keyId == null || keyId.isBlank() || keySecret == null || keySecret.isBlank()) {
            throw new IllegalStateException("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required for Razorpay");
        }
        this.keyId = keyId;
        this.keySecret = keySecret;
        this.webhookSecret = webhookSecret;
        this.apiUrl = apiUrl.endsWith("/") ? apiUrl.substring(0, apiUrl.length() - 1) : apiUrl;
        this.timeout = timeout;
        this.json = json;
        this.http = HttpClient.newBuilder().connectTimeout(timeout).build();
        this.authorization = "Basic " + Base64.getEncoder()
                .encodeToString((keyId + ":" + keySecret).getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public String code() {
        return CODE;
    }

    /** The public Key ID: the browser passes it to Razorpay Checkout. */
    public String keyId() {
        return keyId;
    }

    @Override
    public ProviderOrder createOrder(BigDecimal amount, String currency, String receipt, String idempotencyKey) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("amount", paise(amount));
        body.put("currency", currency);
        body.put("receipt", receipt);
        body.put("notes", Map.of("receipt", receipt));
        JsonNode order = call("POST", "/orders", body, null);
        return new ProviderOrder(order.path("id").asString(""), rupees(order.path("amount").asLong()),
                order.path("currency").asString(currency));
    }

    @Override
    public boolean verifyCheckoutSignature(String providerOrderId, String providerPaymentId, String signature) {
        return Signatures.matches((providerOrderId + "|" + providerPaymentId).getBytes(StandardCharsets.UTF_8),
                keySecret, signature);
    }

    @Override
    public boolean verifyWebhookSignature(byte[] rawBody, String signatureHeader) {
        return Signatures.matches(rawBody, webhookSecret, signatureHeader);
    }

    @Override
    public ProviderPayment fetchPayment(String providerPaymentId) {
        return payment(call("GET", "/payments/" + providerPaymentId, null, null));
    }

    @Override
    public List<ProviderPayment> fetchOrderPayments(String providerOrderId) {
        JsonNode result = call("GET", "/orders/" + providerOrderId + "/payments", null, null);
        List<ProviderPayment> payments = new ArrayList<>();
        for (JsonNode item : result.path("items")) {
            payments.add(payment(item));
        }
        return payments;
    }

    @Override
    public ProviderRefund refund(String providerPaymentId, BigDecimal amount, String idempotencyKey) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("amount", paise(amount));
        body.put("speed", "normal");
        body.put("receipt", idempotencyKey);
        return refund(call("POST", "/payments/" + providerPaymentId + "/refund", body, idempotencyKey));
    }

    @Override
    public ProviderRefund fetchRefund(String providerRefundId) {
        return refund(call("GET", "/refunds/" + providerRefundId, null, null));
    }

    // ------------------------------------------------------------------ mapping

    /** A Razorpay payment entity (API answer or webhook payload) as our provider-neutral view. */
    public static ProviderPayment payment(JsonNode node) {
        String status = node.path("status").asString("");
        PaymentState state = switch (status) {
            case "captured" -> PaymentState.CAPTURED;
            case "failed" -> PaymentState.FAILED;
            // created, authorized (captured later, or by auto-capture), refunded (was captured before)
            case "refunded" -> PaymentState.CAPTURED;
            default -> PaymentState.PENDING;
        };
        return new ProviderPayment(node.path("id").asString(""), textOrNull(node.path("order_id")), state,
                rupees(node.path("amount").asLong()), node.path("currency").asString(null),
                textOrNull(node.path("method")), textOrNull(node.path("error_code")),
                textOrNull(node.path("error_description")));
    }

    /** A Razorpay refund entity (API answer or webhook payload). */
    public static ProviderRefund refund(JsonNode node) {
        RefundState state = switch (node.path("status").asString("")) {
            case "processed" -> RefundState.PROCESSED;
            case "failed" -> RefundState.FAILED;
            default -> RefundState.PENDING;
        };
        return new ProviderRefund(node.path("id").asString(""), textOrNull(node.path("payment_id")), state,
                rupees(node.path("amount").asLong()), state == RefundState.FAILED ? "Rejected by Razorpay" : null);
    }

    private static String textOrNull(JsonNode node) {
        return node.isMissingNode() || node.isNull() ? null : node.asString(null);
    }

    static long paise(BigDecimal rupees) {
        return rupees.multiply(HUNDRED).setScale(0, java.math.RoundingMode.UNNECESSARY).longValueExact();
    }

    static BigDecimal rupees(long paise) {
        return BigDecimal.valueOf(paise).divide(HUNDRED, 2, java.math.RoundingMode.UNNECESSARY);
    }

    // ------------------------------------------------------------------ HTTP

    private JsonNode call(String method, String path, Map<String, Object> body, String idempotencyKey) {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(apiUrl + path)).timeout(timeout)
                .header("Authorization", authorization).header("Accept", "application/json");
        if (idempotencyKey != null) {
            request.header("X-Refund-Idempotency", idempotencyKey);
        }
        if (body == null) {
            request.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            request.header("Content-Type", "application/json")
                    .method(method, HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        }
        try {
            HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            int status = response.statusCode();
            if (status >= 200 && status < 300) {
                return json.readTree(response.body());
            }
            String reason = errorDescription(response.body());
            log.warn("Razorpay {} {} failed status={} reason={}", method, path, status, reason);
            // 4xx: Razorpay understood and refused (but 429 = try later).
            boolean rejected = status >= 400 && status < 500 && status != 429;
            throw new ProviderException("Razorpay answered " + status + ": " + reason, rejected);
        } catch (IOException ex) {
            throw new ProviderException("Razorpay could not be reached: " + ex.getClass().getSimpleName(), false, ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new ProviderException("Interrupted while calling Razorpay", false, ex);
        }
    }

    private String errorDescription(String body) {
        try {
            return json.readTree(body).path("error").path("description").asString("no description");
        } catch (RuntimeException ex) {
            return "unreadable answer";
        }
    }
}
