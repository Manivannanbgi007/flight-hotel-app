package com.flighthotel.payment.provider;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.flighthotel.payment.provider.PaymentProvider.PaymentState;
import com.flighthotel.payment.provider.PaymentProvider.ProviderOrder;
import com.flighthotel.payment.provider.PaymentProvider.ProviderPayment;
import com.flighthotel.payment.provider.PaymentProvider.ProviderRefund;
import com.flighthotel.payment.provider.PaymentProvider.RefundState;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The Razorpay adapter on its own, against a local HTTP server that answers like Razorpay's REST API: what is sent
 * (paise, Basic authentication, the refund idempotency key), how answers are mapped, and how failures are classified.
 * A refusal (4xx) is final; an outage, a rate limit, a timeout or no connection is an unknown outcome the callers
 * retry or reconcile (PAYMENT_INTEGRATION.md section 6).
 */
class RazorpayPaymentProviderTest {

    private static final String KEY_ID = "rzp_test_adapter";
    private static final String KEY_SECRET = "adapter-key-secret";
    private static final String WEBHOOK_SECRET = "adapter-webhook-secret";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private record Answer(int status, String body, long delayMillis) {
    }

    private record Received(String method, String path, Map<String, List<String>> headers, String body) {

        String header(String name) {
            return headers.entrySet().stream().filter(e -> e.getKey().equalsIgnoreCase(name))
                    .map(e -> e.getValue().getFirst()).findFirst().orElse(null);
        }
    }

    private static final Map<String, Answer> ANSWERS = new ConcurrentHashMap<>();
    private static final List<Received> RECEIVED = new CopyOnWriteArrayList<>();
    private static ExecutorService executor;
    private static HttpServer razorpay;
    private static String apiUrl;

    @BeforeAll
    static void startRazorpay() throws IOException {
        executor = Executors.newCachedThreadPool();
        razorpay = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        razorpay.createContext("/v1", RazorpayPaymentProviderTest::answer);
        razorpay.setExecutor(executor);
        razorpay.start();
        apiUrl = "http://localhost:" + razorpay.getAddress().getPort() + "/v1/";
    }

    @AfterAll
    static void stopRazorpay() {
        razorpay.stop(0);
        executor.shutdownNow();
    }

    @BeforeEach
    void reset() {
        ANSWERS.clear();
        RECEIVED.clear();
    }

    private static void answer(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath().substring("/v1".length());
        String key = exchange.getRequestMethod() + " " + path;
        RECEIVED.add(new Received(exchange.getRequestMethod(), path, Map.copyOf(exchange.getRequestHeaders()),
                new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
        Answer answer = ANSWERS.getOrDefault(key, new Answer(404, "{\"error\":{\"description\":\"unknown\"}}", 0));
        try {
            if (answer.delayMillis() > 0) {
                Thread.sleep(answer.delayMillis());
            }
            byte[] bytes = answer.body().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(answer.status(), bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        } catch (InterruptedException | IOException gone) {
            // The client gave up (timeout test) or the server is stopping.
        } finally {
            exchange.close();
        }
    }

    private static void willAnswer(String request, int status, String body) {
        ANSWERS.put(request, new Answer(status, body, 0));
    }

    private static RazorpayPaymentProvider provider() {
        return new RazorpayPaymentProvider(KEY_ID, KEY_SECRET, WEBHOOK_SECRET, apiUrl, Duration.ofSeconds(5), JSON);
    }

    // ------------------------------------------------------------------ requests

    @Test
    void ordersAreCreatedInPaiseWithBasicAuthentication() {
        willAnswer("POST /orders", 200, "{\"id\":\"order_1\",\"amount\":262550,\"currency\":\"INR\",\"status\":\"created\"}");

        ProviderOrder order = provider().createOrder(new BigDecimal("2625.50"), "INR", "HT-ABC12345", "key-1");

        assertThat(order).isEqualTo(new ProviderOrder("order_1", new BigDecimal("2625.50"), "INR"));
        Received request = RECEIVED.getFirst();
        assertThat(request.header("Authorization")).isEqualTo("Basic " + Base64.getEncoder()
                .encodeToString((KEY_ID + ":" + KEY_SECRET).getBytes(StandardCharsets.UTF_8)));
        assertThat(request.header("Content-Type")).isEqualTo("application/json");
        assertThat(request.header("X-Refund-Idempotency")).isNull();
        JsonNode body = JSON.readTree(request.body());
        assertThat(body.path("amount").asLong()).isEqualTo(262550);
        assertThat(body.path("currency").asString()).isEqualTo("INR");
        assertThat(body.path("receipt").asString()).isEqualTo("HT-ABC12345");
        assertThat(body.path("notes").path("receipt").asString()).isEqualTo("HT-ABC12345");
        assertThat(request.body()).doesNotContain(KEY_SECRET);
    }

    @Test
    void amountsThatAreNotWholePaiseAreRefusedNotRounded() {
        assertThat(RazorpayPaymentProvider.paise(new BigDecimal("2625.5"))).isEqualTo(262550);
        assertThat(RazorpayPaymentProvider.paise(new BigDecimal("1"))).isEqualTo(100);
        assertThat(RazorpayPaymentProvider.rupees(262550)).isEqualByComparingTo("2625.50");
        assertThat(RazorpayPaymentProvider.rupees(1)).isEqualByComparingTo("0.01");
        assertThatThrownBy(() -> RazorpayPaymentProvider.paise(new BigDecimal("10.005")))
                .isInstanceOf(ArithmeticException.class);
        assertThat(RECEIVED).isEmpty();
    }

    @Test
    void aRefundCarriesItsIdempotencyKeySoARetryNeverRefundsTwice() {
        willAnswer("POST /payments/pay_1/refund", 200,
                "{\"id\":\"rfnd_1\",\"payment_id\":\"pay_1\",\"amount\":50000,\"status\":\"processed\"}");

        ProviderRefund refund = provider().refund("pay_1", new BigDecimal("500.00"), "refund-request-1");

        assertThat(refund).isEqualTo(new ProviderRefund("rfnd_1", "pay_1", RefundState.PROCESSED,
                new BigDecimal("500.00"), null));
        Received request = RECEIVED.getFirst();
        assertThat(request.header("X-Refund-Idempotency")).isEqualTo("refund-request-1");
        JsonNode body = JSON.readTree(request.body());
        assertThat(body.path("amount").asLong()).isEqualTo(50000);
        assertThat(body.path("speed").asString()).isEqualTo("normal");
        assertThat(body.path("receipt").asString()).isEqualTo("refund-request-1");
    }

    // ------------------------------------------------------------------ answers

    @Test
    void refundStatesAreMapped() {
        assertThat(refundIn("processed").state()).isEqualTo(RefundState.PROCESSED);
        assertThat(refundIn("pending").state()).isEqualTo(RefundState.PENDING);
        assertThat(refundIn("created").state()).isEqualTo(RefundState.PENDING);
        ProviderRefund failed = refundIn("failed");
        assertThat(failed.state()).isEqualTo(RefundState.FAILED);
        assertThat(failed.failure()).isEqualTo("Rejected by Razorpay");
    }

    @Test
    void paymentStatesAreMapped() {
        assertThat(paymentIn("captured").state()).isEqualTo(PaymentState.CAPTURED);
        // Captured earlier and refunded since: it was paid.
        assertThat(paymentIn("refunded").state()).isEqualTo(PaymentState.CAPTURED);
        // Authorised but not captured yet, or only created: not paid yet.
        assertThat(paymentIn("authorized").state()).isEqualTo(PaymentState.PENDING);
        assertThat(paymentIn("created").state()).isEqualTo(PaymentState.PENDING);

        willAnswer("GET /payments/pay_bad", 200, "{\"id\":\"pay_bad\",\"order_id\":\"order_1\",\"amount\":262550,"
                + "\"currency\":\"INR\",\"status\":\"failed\",\"method\":\"card\",\"error_code\":\"BAD_REQUEST_ERROR\","
                + "\"error_description\":\"Payment declined by the bank\"}");
        assertThat(provider().fetchPayment("pay_bad")).isEqualTo(new ProviderPayment("pay_bad", "order_1",
                PaymentState.FAILED, new BigDecimal("2625.50"), "INR", "card", "BAD_REQUEST_ERROR",
                "Payment declined by the bank"));
    }

    @Test
    void missingAndNullFieldsBecomeNull() {
        willAnswer("GET /payments/pay_min", 200,
                "{\"id\":\"pay_min\",\"order_id\":null,\"amount\":100,\"status\":\"captured\",\"error_code\":null}");
        ProviderPayment payment = provider().fetchPayment("pay_min");
        assertThat(payment.orderId()).isNull();
        assertThat(payment.method()).isNull();
        assertThat(payment.errorCode()).isNull();
        assertThat(payment.currency()).isNull();
    }

    @Test
    void thePaymentsOfAnOrderAreListed() {
        willAnswer("GET /orders/order_1/payments", 200, "{\"items\":["
                + "{\"id\":\"pay_1\",\"order_id\":\"order_1\",\"amount\":100,\"status\":\"failed\"},"
                + "{\"id\":\"pay_2\",\"order_id\":\"order_1\",\"amount\":100,\"status\":\"captured\"}]}");
        willAnswer("GET /orders/order_2/payments", 200, "{\"entity\":\"collection\",\"count\":0,\"items\":[]}");

        assertThat(provider().fetchOrderPayments("order_1")).extracting(ProviderPayment::paymentId)
                .containsExactly("pay_1", "pay_2");
        assertThat(provider().fetchOrderPayments("order_2")).isEmpty();
    }

    // ------------------------------------------------------------------ failures

    @Test
    void aRefusalIsFinalButOutagesAndRateLimitsAreWorthRetrying() {
        assertFailure(400, "{\"error\":{\"description\":\"The id provided does not exist\"}}", true,
                "Razorpay answered 400: The id provided does not exist");
        assertFailure(401, "{\"error\":{\"description\":\"Authentication failed\"}}", true, "answered 401");
        assertFailure(404, "{\"error\":{\"description\":\"Not found\"}}", true, "answered 404");
        assertFailure(429, "{\"error\":{\"description\":\"Too many requests\"}}", false, "answered 429");
        assertFailure(500, "{\"error\":{\"description\":\"Internal error\"}}", false, "answered 500");
        assertFailure(503, "<html>Service Unavailable</html>", false, "answered 503: unreadable answer");
    }

    @Test
    void aSlowAnswerIsAnUnknownOutcomeNotARefusal() {
        ANSWERS.put("POST /payments/pay_1/refund", new Answer(200, "{\"id\":\"rfnd_late\",\"status\":\"processed\"}",
                3_000));
        RazorpayPaymentProvider impatient = new RazorpayPaymentProvider(KEY_ID, KEY_SECRET, WEBHOOK_SECRET, apiUrl,
                Duration.ofMillis(300), JSON);

        long started = System.nanoTime();
        assertThatThrownBy(() -> impatient.refund("pay_1", new BigDecimal("500.00"), "refund-request-2"))
                .isInstanceOfSatisfying(ProviderException.class, ex -> {
                    assertThat(ex.isRejected()).isFalse();
                    assertThat(ex.getMessage()).isEqualTo("Razorpay could not be reached: HttpTimeoutException");
                });
        // The caller is not kept waiting for Razorpay's late answer.
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(2_500));
    }

    @Test
    void anUnreachableRazorpayIsWorthRetrying() throws IOException {
        int closedPort;
        try (ServerSocket socket = new ServerSocket(0)) {
            closedPort = socket.getLocalPort();
        }
        RazorpayPaymentProvider unreachable = new RazorpayPaymentProvider(KEY_ID, KEY_SECRET, WEBHOOK_SECRET,
                "http://localhost:" + closedPort + "/v1", Duration.ofSeconds(2), JSON);

        assertThatThrownBy(() -> unreachable.fetchPayment("pay_1"))
                .isInstanceOfSatisfying(ProviderException.class, ex -> {
                    assertThat(ex.isRejected()).isFalse();
                    assertThat(ex.getMessage()).startsWith("Razorpay could not be reached: ");
                });
    }

    // ------------------------------------------------------------------ keys and signatures

    @Test
    void theKeysAreRequiredAndNeverEchoed() {
        assertThatThrownBy(() -> new RazorpayPaymentProvider("", KEY_SECRET, WEBHOOK_SECRET, apiUrl,
                Duration.ofSeconds(1), JSON)).isInstanceOf(IllegalStateException.class)
                .hasMessageNotContaining(KEY_SECRET);
        assertThatThrownBy(() -> new RazorpayPaymentProvider(KEY_ID, " ", WEBHOOK_SECRET, apiUrl,
                Duration.ofSeconds(1), JSON)).isInstanceOf(IllegalStateException.class);
        assertThat(provider().keyId()).isEqualTo(KEY_ID);
    }

    @Test
    void checkoutAndWebhookSignaturesUseTheirOwnSecrets() {
        RazorpayPaymentProvider provider = provider();
        String checkout = Signatures.hmacSha256Hex("order_1|pay_1", KEY_SECRET);
        assertThat(provider.verifyCheckoutSignature("order_1", "pay_1", checkout)).isTrue();
        assertThat(provider.verifyCheckoutSignature("order_1", "pay_2", checkout)).isFalse();
        assertThat(provider.verifyCheckoutSignature("order_1", "pay_1",
                Signatures.hmacSha256Hex("order_1|pay_1", WEBHOOK_SECRET))).isFalse();

        byte[] body = "{\"event\":\"payment.captured\"}".getBytes(StandardCharsets.UTF_8);
        assertThat(provider.verifyWebhookSignature(body, Signatures.hmacSha256Hex(body, WEBHOOK_SECRET))).isTrue();
        assertThat(provider.verifyWebhookSignature(body, Signatures.hmacSha256Hex(body, KEY_SECRET))).isFalse();

        // Webhooks not configured: every webhook is refused.
        RazorpayPaymentProvider noWebhookSecret = new RazorpayPaymentProvider(KEY_ID, KEY_SECRET, "", apiUrl,
                Duration.ofSeconds(1), JSON);
        assertThat(noWebhookSecret.verifyWebhookSignature(body, Signatures.hmacSha256Hex(body, KEY_SECRET)))
                .isFalse();
        assertThat(RECEIVED).isEmpty();
    }

    // ------------------------------------------------------------------ helpers

    private static ProviderRefund refundIn(String status) {
        willAnswer("GET /refunds/rfnd_" + status, 200, "{\"id\":\"rfnd_" + status
                + "\",\"payment_id\":\"pay_1\",\"amount\":100,\"status\":\"" + status + "\"}");
        return provider().fetchRefund("rfnd_" + status);
    }

    private static ProviderPayment paymentIn(String status) {
        willAnswer("GET /payments/pay_" + status, 200, "{\"id\":\"pay_" + status
                + "\",\"order_id\":\"order_1\",\"amount\":262550,\"currency\":\"INR\",\"status\":\"" + status + "\"}");
        return provider().fetchPayment("pay_" + status);
    }

    private static void assertFailure(int status, String body, boolean rejected, String messagePart) {
        willAnswer("GET /payments/pay_err", status, body);
        assertThatThrownBy(() -> provider().fetchPayment("pay_err"))
                .isInstanceOfSatisfying(ProviderException.class, ex -> {
                    assertThat(ex.isRejected()).as("rejected for %d", status).isEqualTo(rejected);
                    assertThat(ex.getMessage()).contains(messagePart).doesNotContain(KEY_SECRET);
                });
    }
}
