package com.flighthotel.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.ResultActions;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.events.payment.RefundFailed;
import com.flighthotel.payment.provider.Signatures;
import com.flighthotel.payment.scheduler.ReconciliationJob;
import com.jayway.jsonpath.JsonPath;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * The Razorpay adapter, signatures, webhooks and reconciliation, against a small stand-in for Razorpay's API
 * (a local HTTP server), so every request and answer is real HTTP but no account or network is needed.
 */
@TestPropertySource(properties = "payment.provider=razorpay")
class RazorpayPaymentFlowTest extends PaymentIntegrationTest {

    static final String KEY_SECRET = "razorpay-test-secret";
    static final String WEBHOOK_SECRET = "razorpay-webhook-secret";

    // ------------------------------------------------------------------ the stand-in for Razorpay

    static final Map<String, String> PAYMENTS = new ConcurrentHashMap<>();
    static final Map<String, String> REFUNDS = new ConcurrentHashMap<>();
    static final List<String> REQUESTS = new CopyOnWriteArrayList<>();
    static final AtomicInteger IDS = new AtomicInteger();
    static final AtomicReference<String> REFUND_ANSWER = new AtomicReference<>("processed");
    static volatile boolean down;
    static final HttpServer RAZORPAY = startStub();

    @DynamicPropertySource
    static void razorpay(DynamicPropertyRegistry registry) {
        registry.add("payment.razorpay.api-url", () -> "http://localhost:" + RAZORPAY.getAddress().getPort() + "/v1");
    }

    private static HttpServer startStub() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
            server.createContext("/v1", RazorpayPaymentFlowTest::handle);
            server.start();
            return server;
        } catch (IOException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath().substring("/v1".length());
        String method = exchange.getRequestMethod();
        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        REQUESTS.add(method + " " + path + " auth=" + exchange.getRequestHeaders().getFirst("Authorization")
                + " idem=" + exchange.getRequestHeaders().getFirst("X-Refund-Idempotency") + " " + body);
        int status = 200;
        String answer;
        if (down) {
            status = 503;
            answer = "{\"error\":{\"description\":\"down\"}}";
        } else if (method.equals("POST") && path.equals("/orders")) {
            long amount = Long.parseLong(body.replaceAll(".*\"amount\":(\\d+).*", "$1"));
            answer = "{\"id\":\"order_" + IDS.incrementAndGet() + "\",\"amount\":" + amount
                    + ",\"currency\":\"INR\",\"status\":\"created\"}";
        } else if (method.equals("GET") && path.matches("/payments/[^/]+")) {
            answer = PAYMENTS.get(path.substring("/payments/".length()));
            if (answer == null) {
                status = 400;
                answer = "{\"error\":{\"description\":\"The id provided does not exist\"}}";
            }
        } else if (method.equals("GET") && path.matches("/orders/[^/]+/payments")) {
            String orderId = path.split("/")[2];
            String items = String.join(",", PAYMENTS.values().stream()
                    .filter(p -> p.contains("\"order_id\":\"" + orderId + "\"")).toList());
            answer = "{\"items\":[" + items + "]}";
        } else if (method.equals("POST") && path.matches("/payments/[^/]+/refund")) {
            String state = REFUND_ANSWER.get();
            if (state.equals("reject")) {
                status = 400;
                answer = "{\"error\":{\"description\":\"The refund amount is greater than the payment\"}}";
            } else {
                String amount = body.replaceAll(".*\"amount\":(\\d+).*", "$1");
                String id = "rfnd_" + IDS.incrementAndGet();
                answer = "{\"id\":\"" + id + "\",\"payment_id\":\"" + path.split("/")[2] + "\",\"amount\":" + amount
                        + ",\"status\":\"" + state + "\"}";
                REFUNDS.put(id, answer);
            }
        } else if (method.equals("GET") && path.matches("/refunds/[^/]+")) {
            answer = REFUNDS.getOrDefault(path.substring("/refunds/".length()), "{}");
        } else {
            status = 404;
            answer = "{\"error\":{\"description\":\"unknown\"}}";
        }
        byte[] bytes = answer.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    private static String razorpayPayment(String paymentId, String orderId, long paise, String state) {
        String error = state.equals("failed")
                ? "\"error_code\":\"BAD_REQUEST_ERROR\",\"error_description\":\"Payment declined by the bank\""
                : "\"error_code\":null,\"error_description\":null";
        return "{\"id\":\"%s\",\"order_id\":\"%s\",\"amount\":%d,\"currency\":\"INR\",\"status\":\"%s\","
                .formatted(paymentId, orderId, paise, state) + "\"method\":\"upi\"," + error
                + ",\"email\":\"private@example.com\",\"contact\":\"+919800000000\"}";
    }

    @Autowired
    ReconciliationJob reconciliationJob;

    @BeforeEach
    void reset() {
        PAYMENTS.clear();
        REFUNDS.clear();
        REQUESTS.clear();
        REFUND_ANSWER.set("processed");
        down = false;
    }

    // ------------------------------------------------------------------ orders and the browser callback

    @Test
    void theOrderIsCreatedInPaiseForTheReceiptOfTheBooking() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.50");

        createOrderCall(userId, bookingId, "key-12345678").andExpect(status().isOk())
                .andExpect(jsonPath("$.provider").value("RAZORPAY")).andExpect(jsonPath("$.keyId").value("rzp_test_key"))
                .andExpect(jsonPath("$.amount").value(2625.50)).andExpect(jsonPath("$.orderId").value("order_" + IDS.get()));

        String request = REQUESTS.stream().filter(r -> r.startsWith("POST /orders")).findFirst().orElseThrow();
        assertThat(request).contains("\"amount\":262550").contains("\"currency\":\"INR\"")
                .contains("\"receipt\":\"HT-" + bookingId.toString().substring(0, 8).toUpperCase() + "\"")
                .contains("auth=Basic ");
        // The Key Secret is only ever sent as the Basic credential, never in the body or the answer.
        assertThat(request).doesNotContain(KEY_SECRET);
    }

    @Test
    void aCapturedPaymentWithTheRightSignatureAndAmountSucceeds() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        PAYMENTS.put("pay_ok1", razorpayPayment("pay_ok1", orderId, 262500, "captured"));

        verifyCall(userId, orderId, "pay_ok1", sign(orderId, "pay_ok1")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUCCESS")).andExpect(jsonPath("$.method").value("upi"));

        PaymentSucceeded succeeded = single(bookingId, PaymentSucceeded.class);
        assertThat(succeeded.getProviderPaymentId()).isEqualTo("pay_ok1");
        assertThat(succeeded.getProvider()).isEqualTo("RAZORPAY");
        assertThat(EventMoney.amount(succeeded.getAmount())).isEqualByComparingTo("2625.00");
    }

    @Test
    void aWrongSignatureIsRefusedAndRazorpayIsNotEvenAsked() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        PAYMENTS.put("pay_ok1", razorpayPayment("pay_ok1", orderId, 262500, "captured"));
        REQUESTS.clear();

        verifyCall(userId, orderId, "pay_ok1", sign(orderId, "pay_other")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAYMENT_SIGNATURE"));

        assertThat(REQUESTS).isEmpty();
        assertThat(eventsOf(bookingId, PaymentSucceeded.class)).isEmpty();
    }

    @Test
    void aCapturedAmountThatDiffersFromTheOrderIsFlaggedNotConfirmed() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        PAYMENTS.put("pay_low", razorpayPayment("pay_low", orderId, 100, "captured"));

        verifyCall(userId, orderId, "pay_low", sign(orderId, "pay_low")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("INITIATED"))
                .andExpect(jsonPath("$.failureCode").value("AMOUNT_MISMATCH"));
        assertThat(eventsOf(bookingId, PaymentSucceeded.class)).isEmpty();
    }

    @Test
    void aPaymentOfAnotherOrderIsRefused() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        PAYMENTS.put("pay_x", razorpayPayment("pay_x", "order_somebody_else", 262500, "captured"));

        verifyCall(userId, orderId, "pay_x", sign(orderId, "pay_x")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PAYMENT_ORDER_MISMATCH"));
        assertThat(eventsOf(bookingId, PaymentSucceeded.class)).isEmpty();
    }

    @Test
    void anAuthorizedPaymentWaitsAndAFailedOneIsRecorded() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        PAYMENTS.put("pay_auth", razorpayPayment("pay_auth", orderId, 262500, "authorized"));
        verifyCall(userId, orderId, "pay_auth", sign(orderId, "pay_auth")).andExpect(jsonPath("$.status").value("PENDING"));

        PAYMENTS.put("pay_bad", razorpayPayment("pay_bad", orderId, 262500, "failed"));
        verifyCall(userId, orderId, "pay_bad", sign(orderId, "pay_bad")).andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.failureCode").value("BAD_REQUEST_ERROR"));
        PaymentFailed failed = single(bookingId, PaymentFailed.class);
        assertThat(failed.getFailureReason()).isEqualTo("Payment declined by the bank");

        // Razorpay Checkout lets the customer retry inside the same order: the later success still counts.
        PAYMENTS.put("pay_retry", razorpayPayment("pay_retry", orderId, 262500, "captured"));
        verifyCall(userId, orderId, "pay_retry", sign(orderId, "pay_retry")).andExpect(jsonPath("$.status").value("SUCCESS"));
    }

    // ------------------------------------------------------------------ webhooks

    @Test
    void aWebhookWithAWrongSignatureIsRejectedAndChangesNothing() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        String body = webhookBody("payment.captured", razorpayPayment("pay_w1", orderId, 262500, "captured"));

        mockMvc.perform(post("/api/payments/webhook").header("X-Razorpay-Signature", Signatures.hmacSha256Hex(body, "wrong"))
                        .header("X-Razorpay-Event-Id", "evt_bad").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("INVALID_WEBHOOK_SIGNATURE"));
        mockMvc.perform(post("/api/payments/webhook").header("X-Razorpay-Event-Id", "evt_none")
                        .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isUnauthorized());
        // A tampered body (amount changed after signing) fails too.
        String signature = Signatures.hmacSha256Hex(body, WEBHOOK_SECRET);
        mockMvc.perform(post("/api/payments/webhook").header("X-Razorpay-Signature", signature)
                        .header("X-Razorpay-Event-Id", "evt_tampered").contentType(MediaType.APPLICATION_JSON)
                        .content(body.replace("262500", "100"))).andExpect(status().isUnauthorized());

        assertThat(paymentStatus(bookingId)).isEqualTo("INITIATED");
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM payment_webhook_events "
                + "WHERE provider_event_id IN ('evt_bad', 'evt_none', 'evt_tampered')")
                .query(Long.class).single()).isZero();
    }

    @Test
    void aSignedCaptureWebhookConfirmsThePaymentAndARepeatedDeliveryIsIgnored() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        String body = webhookBody("payment.captured", razorpayPayment("pay_w1", orderId, 262500, "captured"));

        webhook("evt_capture_1", body).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PROCESSED"));
        assertThat(paymentStatus(bookingId)).isEqualTo("SUCCESS");
        // Razorpay delivers the same event again (retry), and then order.paid for the same payment.
        webhook("evt_capture_1", body).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("DUPLICATE"));
        webhook("evt_orderpaid_1", webhookBody("order.paid", razorpayPayment("pay_w1", orderId, 262500, "captured")))
                .andExpect(status().isOk());

        assertThat(eventsOf(bookingId, PaymentSucceeded.class)).hasSize(1);
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM payment_webhook_events WHERE provider_event_id = 'evt_capture_1'")
                .query(Long.class).single()).isEqualTo(1L);
        // And the browser callback arriving later changes nothing.
        PAYMENTS.put("pay_w1", razorpayPayment("pay_w1", orderId, 262500, "captured"));
        verifyCall(userId, orderId, "pay_w1", sign(orderId, "pay_w1")).andExpect(jsonPath("$.status").value("SUCCESS"));
        assertThat(eventsOf(bookingId, PaymentSucceeded.class)).hasSize(1);
    }

    @Test
    void theSameWebhookDeliveredSeveralTimesAtOnceIsAppliedOnce() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        String body = webhookBody("payment.captured", razorpayPayment("pay_race", orderId, 262500, "captured"));

        // Razorpay retries while the first delivery is still being handled: all of them arrive together.
        int deliveries = 6;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(deliveries);
        try {
            List<Future<MockHttpServletResponse>> answers = new ArrayList<>();
            for (int i = 0; i < deliveries; i++) {
                answers.add(pool.submit(() -> {
                    start.await();
                    return webhook("evt_race_1", body).andReturn().getResponse();
                }));
            }
            start.countDown();
            List<String> outcomes = new ArrayList<>();
            for (Future<MockHttpServletResponse> answer : answers) {
                MockHttpServletResponse response = answer.get(30, TimeUnit.SECONDS);
                // Every delivery is acknowledged, so Razorpay stops retrying.
                assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
                outcomes.add(JsonPath.read(response.getContentAsString(), "$.status"));
            }
            assertThat(outcomes).containsOnlyOnce("PROCESSED").containsOnly("PROCESSED", "DUPLICATE");
        } finally {
            pool.shutdownNow();
        }

        assertThat(paymentStatus(bookingId)).isEqualTo("SUCCESS");
        assertThat(eventsOf(bookingId, PaymentSucceeded.class)).hasSize(1);
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM payment_webhook_events WHERE provider_event_id = 'evt_race_1'")
                .query(Long.class).single()).isEqualTo(1L);
    }

    @Test
    void aFailedPaymentWebhookIsAppliedAndTheStoredSummaryHoldsNoPersonalData() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");

        webhook("evt_fail_1", webhookBody("payment.failed", razorpayPayment("pay_f1", orderId, 262500, "failed")))
                .andExpect(status().isOk());

        assertThat(paymentStatus(bookingId)).isEqualTo("FAILED");
        assertThat(eventsOf(bookingId, PaymentFailed.class)).hasSize(1);
        String summary = jdbcClient.sql("SELECT CAST(summary AS CHAR) FROM payment_webhook_events "
                + "WHERE provider_event_id = 'evt_fail_1'").query(String.class).single();
        assertThat(summary).contains("pay_f1").contains(orderId)
                .doesNotContain("private@example.com").doesNotContain("+919800000000");
    }

    @Test
    void unknownEventsOrdersAndBrokenBodiesAreHandledSafely() throws Exception {
        webhook("evt_unknown_1", "{\"event\":\"settlement.processed\",\"payload\":{}}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("IGNORED"));
        webhook("evt_unknown_2", webhookBody("payment.captured",
                razorpayPayment("pay_z", "order_nobody_knows", 100, "captured")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("IGNORED"));
        // Signed but not JSON, and signed without an event id.
        String garbage = "not json at all";
        mockMvc.perform(post("/api/payments/webhook").header("X-Razorpay-Signature", Signatures.hmacSha256Hex(garbage, WEBHOOK_SECRET))
                        .header("X-Razorpay-Event-Id", "evt_garbage").contentType(MediaType.TEXT_PLAIN).content(garbage))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/payments/webhook").header("X-Razorpay-Signature", Signatures.hmacSha256Hex("{}", WEBHOOK_SECRET))
                        .contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isBadRequest());
    }

    // ------------------------------------------------------------------ reconciliation

    @Test
    void aPaymentTheBrowserNeverReportedIsFoundByTheReconciliationJob() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        PAYMENTS.put("pay_lost", razorpayPayment("pay_lost", orderId, 262500, "captured"));

        reconciliationJob.reconcile();
        assertThat(paymentStatus(bookingId)).as("too young to be asked about").isEqualTo("INITIATED");

        makeOld(bookingId);
        reconciliationJob.reconcile();

        assertThat(paymentStatus(bookingId)).isEqualTo("SUCCESS");
        assertThat(single(bookingId, PaymentSucceeded.class).getProviderPaymentId()).isEqualTo("pay_lost");
    }

    @Test
    void whenRazorpayIsDownAtVerificationTheCustomerWaitsAndTheJobSettlesItLater() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        PAYMENTS.put("pay_late", razorpayPayment("pay_late", orderId, 262500, "captured"));

        down = true;
        verifyCall(userId, orderId, "pay_late", sign(orderId, "pay_late")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));
        assertThat(eventsOf(bookingId, PaymentSucceeded.class)).isEmpty();

        down = false;
        makeOld(bookingId);
        reconciliationJob.reconcile();
        assertThat(paymentStatus(bookingId)).isEqualTo("SUCCESS");
    }

    // ------------------------------------------------------------------ refunds

    @Test
    void aRefundGoesToRazorpayOnceAndAWebhookFinishesIt() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2000.00");
        String paymentId = capturedPayment(userId, bookingId, "pay_r1");
        REFUND_ANSWER.set("pending");

        UUID requestId = UUID.randomUUID();
        refundRequested(userId, bookingId, paymentId, requestId, "1500.00");

        String call = REQUESTS.stream().filter(r -> r.contains("/refund")).findFirst().orElseThrow();
        assertThat(call).startsWith("POST /payments/pay_r1/refund").contains("\"amount\":150000")
                .contains("idem=" + requestId);
        assertThat(paymentStatus(bookingId)).isEqualTo("REFUND_PENDING");
        assertThat(eventsOf(bookingId, RefundCompleted.class)).isEmpty();

        String refundId = REFUNDS.keySet().iterator().next();
        String body = "{\"event\":\"refund.processed\",\"payload\":{\"refund\":{\"entity\":{\"id\":\"" + refundId
                + "\",\"payment_id\":\"pay_r1\",\"amount\":150000,\"status\":\"processed\"}}}}";
        webhook("evt_refund_1", body).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PROCESSED"));
        webhook("evt_refund_1", body).andExpect(jsonPath("$.status").value("DUPLICATE"));

        assertThat(paymentStatus(bookingId)).isEqualTo("PARTIALLY_REFUNDED");
        RefundCompleted completed = single(bookingId, RefundCompleted.class);
        assertThat(completed.getRefundRequestId()).isEqualTo(requestId.toString());
        assertThat(EventMoney.amount(completed.getAmount())).isEqualByComparingTo("1500.00");
    }

    @Test
    void aPendingRefundIsFoundByTheReconciliationJob() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2000.00");
        String paymentId = capturedPayment(userId, bookingId, "pay_r2");
        REFUND_ANSWER.set("pending");
        refundRequested(userId, bookingId, paymentId, UUID.randomUUID(), "2000.00");
        String refundId = REFUNDS.keySet().iterator().next();
        REFUNDS.put(refundId, REFUNDS.get(refundId).replace("pending", "processed"));

        jdbcClient.sql("UPDATE refunds SET created_at = UTC_TIMESTAMP(6) - INTERVAL 1 HOUR "
                + "WHERE booking_id = UUID_TO_BIN(:id)").param("id", bookingId.toString()).update();
        reconciliationJob.reconcile();

        assertThat(paymentStatus(bookingId)).isEqualTo("REFUNDED");
        assertThat(eventsOf(bookingId, RefundCompleted.class)).hasSize(1);
    }

    @Test
    void aRefundRazorpayRefusesIsReportedAsFailedAndThePaymentStaysPaid() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2000.00");
        String paymentId = capturedPayment(userId, bookingId, "pay_r3");
        REFUND_ANSWER.set("reject");

        refundRequested(userId, bookingId, paymentId, UUID.randomUUID(), "2000.00");

        assertThat(single(bookingId, RefundFailed.class).getReason()).contains("greater than the payment");
        assertThat(paymentStatus(bookingId)).isEqualTo("SUCCESS");
        assertThat(eventsOf(bookingId, RefundCompleted.class)).isEmpty();
    }

    // ------------------------------------------------------------------ helpers

    private static String sign(String orderId, String paymentId) {
        return Signatures.hmacSha256Hex(orderId + "|" + paymentId, KEY_SECRET);
    }

    private static String webhookBody(String event, String payment) {
        return "{\"entity\":\"event\",\"event\":\"" + event + "\",\"payload\":{\"payment\":{\"entity\":" + payment + "}}}";
    }

    private ResultActions webhook(String eventId, String body) throws Exception {
        return mockMvc.perform(post("/api/payments/webhook")
                .header("X-Razorpay-Signature", Signatures.hmacSha256Hex(body, WEBHOOK_SECRET))
                .header("X-Razorpay-Event-Id", eventId).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private void makeOld(UUID bookingId) {
        jdbcClient.sql("UPDATE payment_transactions SET created_at = UTC_TIMESTAMP(6) - INTERVAL 20 MINUTE "
                + "WHERE booking_id = UUID_TO_BIN(:id)").param("id", bookingId.toString()).update();
    }

    /** A booking that was paid at Razorpay; returns our payment id. */
    private String capturedPayment(UUID userId, UUID bookingId, String providerPaymentId) throws Exception {
        String order = createOrder(userId, bookingId);
        String orderId = json(order, "$.orderId");
        long paise = new BigDecimal(String.valueOf((Object) com.jayway.jsonpath.JsonPath.read(order, "$.amount")))
                .movePointRight(2).longValue();
        PAYMENTS.put(providerPaymentId, razorpayPayment(providerPaymentId, orderId, paise, "captured"));
        verifyCall(userId, orderId, providerPaymentId, sign(orderId, providerPaymentId)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUCCESS"));
        REQUESTS.clear();
        return json(order, "$.paymentId");
    }

    private void refundRequested(UUID userId, UUID bookingId, String paymentId, UUID requestId, String amount) {
        bookingEvents.handle(eventId(), BookingRefundRequested.newBuilder()
                .setRefundRequestId(requestId.toString())
                .setBookingId(bookingId.toString())
                .setBookingReference("HT-TEST0001")
                .setUserId(userId.toString())
                .setPaymentId(paymentId)
                .setAmount(EventMoney.of(new BigDecimal(amount), "INR"))
                .setReason("CANCELLATION")
                .setContactEmail("asha@example.com")
                .setCustomerName("Asha Rao")
                .setRequestedAt(Instant.now())
                .build());
    }
}
