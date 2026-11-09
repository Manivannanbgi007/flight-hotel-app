package com.flighthotel.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.BookingExpired;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.booking.ConfirmedHotelStay;
import com.flighthotel.events.payment.InvoiceIssued;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.events.payment.RefundFailed;
import com.flighthotel.payment.scheduler.ReconciliationJob;

/** The whole payment flow with the DEMO provider: order, signed callback, verification, refunds, invoices. */
class DemoPaymentFlowTest extends PaymentIntegrationTest {

    @Autowired
    ReconciliationJob reconciliationJob;

    // ------------------------------------------------------------------ orders

    @Test
    void theOrderIsForTheAmountTheServerKnowsAndRepeatingItGivesTheSameOrder() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");

        String first = createOrderCall(userId, bookingId, "key-12345678").andExpect(status().isOk())
                .andExpect(jsonPath("$.amount").value(2625.00)).andExpect(jsonPath("$.provider").value("DEMO"))
                .andExpect(jsonPath("$.keyId").doesNotExist()).andExpect(jsonPath("$.status").value("INITIATED"))
                .andReturn().getResponse().getContentAsString();
        // Same key again, and another key while the first order is still open: the same order, not a second one.
        String sameKey = createOrderCall(userId, bookingId, "key-12345678").andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String otherKey = createOrderCall(userId, bookingId, "key-87654321").andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(json(sameKey, "$.orderId")).isEqualTo(json(first, "$.orderId"));
        assertThat(json(otherKey, "$.orderId")).isEqualTo(json(first, "$.orderId"));
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM payment_transactions WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).query(Long.class).single()).isEqualTo(1L);
    }

    @Test
    void orderRulesAreEnforced() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "1000.00");

        createOrderCall(UUID.randomUUID(), bookingId, "key-12345678").andExpect(status().isNotFound());
        // A booking payment-service has not heard of (yet) is "not ready", so the payment page retries a moment later.
        createOrderCall(userId, UUID.randomUUID(), "key-12345678").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PAYMENT_NOT_READY"));
        mockMvc.perform(post("/api/payments/create-order").with(customer(userId))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"bookingId\":\"" + bookingId + "\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));
        mockMvc.perform(post("/api/payments/create-order").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bookingId\":\"" + bookingId + "\"}"))
                .andExpect(status().isUnauthorized());

        UUID late = payable(userId, "1000.00", Instant.now().minus(1, ChronoUnit.MINUTES));
        createOrderCall(userId, late, "key-late-0001").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PAYMENT_WINDOW_CLOSED"));

        UUID other = payable(userId, "1000.00");
        createOrderCall(userId, other, "key-same-0001").andExpect(status().isOk());
        createOrderCall(userId, bookingId, "key-same-0001").andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REUSED"));
    }

    @Test
    void anExpiredBookingCannotBePaidAnymoreButAnOpenOrderStillSettles() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "1000.00");
        String order = createOrder(userId, bookingId);

        bookingEvents.handle(eventId(), BookingExpired.newBuilder().setBookingId(bookingId.toString())
                .setBookingType("HOTEL").setExpiredAt(Instant.now()).build());
        UUID other = payable(userId, "1000.00");
        bookingEvents.handle(eventId(), BookingExpired.newBuilder().setBookingId(other.toString())
                .setBookingType("HOTEL").setExpiredAt(Instant.now()).build());
        createOrderCall(userId, other, "key-expired-1").andExpect(status().isConflict());

        // The customer was already at the payment page: the money still arrives and is reported (booking-service
        // refunds it, see its saga tests).
        pay(userId, json(order, "$.orderId")).andExpect(jsonPath("$.status").value("SUCCESS"));
        assertThat(single(bookingId, PaymentSucceeded.class).getBookingId()).isEqualTo(bookingId.toString());
    }

    // ------------------------------------------------------------------ paying and verifying

    @Test
    void aSignedCallbackIsVerifiedAndReportedOnce() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");

        String checkout = demo(userId, "pay", orderId);
        String paymentId = json(checkout, "$.paymentId");
        String signature = json(checkout, "$.signature");
        verifyCall(userId, orderId, paymentId, signature).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUCCESS")).andExpect(jsonPath("$.method").value("demo"));
        // The browser repeats the call (reload): same answer, still one event.
        verifyCall(userId, orderId, paymentId, signature).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUCCESS"));

        PaymentSucceeded succeeded = single(bookingId, PaymentSucceeded.class);
        assertThat(succeeded.getProvider()).isEqualTo("DEMO");
        assertThat(EventMoney.amount(succeeded.getAmount())).isEqualByComparingTo("2625.00");
        assertThat(succeeded.getUserId()).isEqualTo(userId.toString());
        assertThat(payableStatus(bookingId)).isEqualTo("PAID");
        createOrderCall(userId, bookingId, "key-after-pay-1").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BOOKING_ALREADY_PAID"));
    }

    @Test
    void aForgedOrTamperedCallbackNeverCountsAsPaid() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2625.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        String checkout = demo(userId, "pay", orderId);
        String signature = json(checkout, "$.signature");

        // Made-up successful payment id with a wrong signature.
        verifyCall(userId, orderId, "pay_demo_ok_forged000000", "0".repeat(64)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAYMENT_SIGNATURE"));
        // A real signature, but for another payment id.
        verifyCall(userId, orderId, "pay_demo_ok_other0000000", signature).andExpect(status().isBadRequest());
        // A failed demo payment cannot be turned into a paid one.
        String failed = demo(userId, "fail", orderId);
        verifyCall(userId, orderId, json(failed, "$.paymentId"), json(failed, "$.signature")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FAILED"));
        // Someone else's order is not even visible.
        verifyCall(UUID.randomUUID(), orderId, json(checkout, "$.paymentId"), signature)
                .andExpect(status().isNotFound());

        assertThat(eventsOf(bookingId, PaymentSucceeded.class)).isEmpty();
    }

    @Test
    void aFailedPaymentIsRecordedAndANewAttemptCanSucceed() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "1800.00");
        String firstOrder = json(createOrder(userId, bookingId), "$.orderId");

        String failed = demo(userId, "fail", firstOrder);
        mockMvc.perform(post("/api/payments/report-failure").with(customer(userId))
                        .contentType(MediaType.APPLICATION_JSON).content("""
                                {"orderId":"%s","paymentId":"%s"}""".formatted(firstOrder, json(failed, "$.paymentId"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.failureCode").value("DEMO_DECLINED"));
        assertThat(single(bookingId, PaymentFailed.class).getFailureCode()).isEqualTo("DEMO_DECLINED");

        // The booking is still payable: a new order (a new attempt), which succeeds.
        String secondOrder = json(createOrder(userId, bookingId), "$.orderId");
        assertThat(secondOrder).isNotEqualTo(firstOrder);
        pay(userId, secondOrder).andExpect(jsonPath("$.status").value("SUCCESS"));
        assertThat(eventsOf(bookingId, PaymentSucceeded.class)).hasSize(1);
        assertThat(eventsOf(bookingId, PaymentFailed.class)).hasSize(1);
    }

    @Test
    void paymentHistoryShowsOnlyMyPaymentsWithTheirBooking() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "999.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        pay(userId, orderId);
        UUID stranger = UUID.randomUUID();
        UUID strangerBooking = payable(stranger, "500.00");
        createOrder(stranger, strangerBooking);

        getAs(userId, "/api/payments").andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].bookingId").value(bookingId.toString()))
                .andExpect(jsonPath("$.content[0].status").value("SUCCESS"))
                .andExpect(jsonPath("$.content[0].description").value("Sea Breeze Resort · 2 nights · 1 room"))
                .andExpect(jsonPath("$.content[0].bookingReference").exists());
        getAs(userId, "/api/payments/booking/" + bookingId).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));

        // Search, filters, sorting and the figures (Phase 12): the same filters in the list and its summary, and a
        // customer can never reach another customer's payments, whatever they type.
        String strangerReference = "HT-" + strangerBooking.toString().substring(0, 8).toUpperCase();
        getAs(userId, "/api/payments?status=SUCCESS&bookingType=HOTEL&sort=amount,desc")
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].bookingType").value("HOTEL"));
        getAs(userId, "/api/payments?bookingType=FLIGHT").andExpect(jsonPath("$.totalElements").value(0));
        getAs(userId, "/api/payments?status=FAILED").andExpect(jsonPath("$.totalElements").value(0));
        getAs(userId, "/api/payments?q=" + strangerReference).andExpect(jsonPath("$.totalElements").value(0));
        getAs(userId, "/api/payments?sort=bogus").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SORT"));
        getAs(userId, "/api/payments?bookingType=CAR").andExpect(status().isBadRequest());
        getAs(userId, "/api/payments/summary").andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1)).andExpect(jsonPath("$.successful").value(1))
                .andExpect(jsonPath("$.failed").value(0)).andExpect(jsonPath("$.pending").value(0))
                .andExpect(jsonPath("$.paidAmount").value(999.0)).andExpect(jsonPath("$.refundedAmount").value(0))
                .andExpect(jsonPath("$.currency").value("INR"));
        getAs(userId, "/api/payments/summary?status=FAILED").andExpect(jsonPath("$.total").value(0));
        getAs(stranger, "/api/payments/summary").andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.pending").value(1)).andExpect(jsonPath("$.successful").value(0))
                .andExpect(jsonPath("$.paidAmount").value(0));
        getAs(stranger, "/api/payments/booking/" + bookingId).andExpect(status().isNotFound());
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/api/payments/booking/" + bookingId).with(supportAgent()))
                .andExpect(status().isOk());
    }

    // ------------------------------------------------------------------ refunds

    private static final io.confluent.kafka.serializers.KafkaAvroDeserializer AUDIT =
            new io.confluent.kafka.serializers.KafkaAvroDeserializer();

    static {
        AUDIT.configure(java.util.Map.of("schema.registry.url", "mock://payment-it", "specific.avro.reader", true),
                false);
    }

    @Test
    void aRefundRequestGivesTheMoneyBackExactlyOnce() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "2000.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        String paymentId = json(pay(userId, orderId).andReturn().getResponse().getContentAsString(), "$.paymentId");

        UUID requestId = UUID.randomUUID();
        refundRequested(userId, bookingId, paymentId, requestId, "2000.00");
        RefundCompleted completed = single(bookingId, RefundCompleted.class);
        assertThat(completed.getRefundRequestId()).isEqualTo(requestId.toString());
        assertThat(EventMoney.amount(completed.getAmount())).isEqualByComparingTo("2000.00");
        assertThat(paymentStatus(bookingId)).isEqualTo("REFUNDED");

        // The same request again (booking-service's reconciliation asks again): no second refund, but the same
        // answer once more, so a lost answer can never leave the booking waiting.
        refundRequested(userId, bookingId, paymentId, requestId, "2000.00");
        assertThat(eventsOf(bookingId, RefundCompleted.class)).hasSize(2)
                .extracting(RefundCompleted::getRefundId).containsOnly(completed.getRefundId());
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM refunds WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).query(Long.class).single()).isEqualTo(1L);
        assertThat(paymentStatus(bookingId)).isEqualTo("REFUNDED");

        // Audited: started and processed, with amounts but no personal data.
        List<com.flighthotel.events.audit.AuditEventRecorded> audit = jdbcClient.sql(
                        "SELECT payload FROM outbox_events WHERE aggregate_type = 'audit' AND aggregate_id = :id "
                                + "ORDER BY created_at, id")
                .param("id", completed.getRefundId())
                .query((rs, i) -> (com.flighthotel.events.audit.AuditEventRecorded) AUDIT.deserialize("audit.events",
                        rs.getBytes("payload")))
                .list();
        assertThat(audit).extracting(event -> event.getAction()).containsExactly("REFUND_STARTED", "REFUND_PROCESSED");
        assertThat(audit.getFirst().getDetails()).containsEntry("amount", "2000.00")
                .containsEntry("refundRequestId", requestId.toString()).containsEntry("reason", "CANCELLATION")
                .doesNotContainKey("contactEmail");
    }

    @Test
    void partialRefundsAddUpButNeverExceedThePayment() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "1000.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        String paymentId = json(pay(userId, orderId).andReturn().getResponse().getContentAsString(), "$.paymentId");

        refundRequested(userId, bookingId, paymentId, UUID.randomUUID(), "400.00");
        assertThat(paymentStatus(bookingId)).isEqualTo("PARTIALLY_REFUNDED");
        UUID tooMuch = UUID.randomUUID();
        refundRequested(userId, bookingId, paymentId, tooMuch, "700.00");
        // 400 + 700 > 1000: refused, and the booking is told.
        assertThat(single(bookingId, RefundFailed.class).getReason()).contains("more than");
        // Asked again: the same refusal again, still nothing sent to the provider.
        refundRequested(userId, bookingId, paymentId, tooMuch, "700.00");
        assertThat(eventsOf(bookingId, RefundFailed.class)).hasSize(2)
                .allSatisfy(failed -> assertThat(failed.getRefundRequestId()).isEqualTo(tooMuch.toString()));
        assertThat(paymentStatus(bookingId)).isEqualTo("PARTIALLY_REFUNDED");
        refundRequested(userId, bookingId, paymentId, UUID.randomUUID(), "600.00");
        assertThat(paymentStatus(bookingId)).isEqualTo("REFUNDED");
        assertThat(eventsOf(bookingId, RefundCompleted.class)).hasSize(2);
    }

    @Test
    void aPaymentThatWasNeverCapturedCannotBeRefunded() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "1000.00");
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        String paymentId = jdbcClient.sql("SELECT BIN_TO_UUID(id) FROM payment_transactions WHERE provider_order_id = :o")
                .param("o", orderId).query(String.class).single();

        refundRequested(userId, bookingId, paymentId, UUID.randomUUID(), "1000.00");
        assertThat(single(bookingId, RefundFailed.class).getReason()).contains("never captured");
    }

    // ------------------------------------------------------------------ invoices

    @Test
    void aConfirmedBookingGetsAnInvoiceWithAGapFreeNumber() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID first = paidBooking(userId, "2625.00");
        UUID second = paidBooking(userId, "1050.00");

        confirmed(userId, first, "2625.00", "125.00");
        confirmed(userId, first, "2625.00", "125.00");   // duplicate: still one invoice
        confirmed(userId, second, "1050.00", "50.00");

        InvoiceIssued firstInvoice = single(first, InvoiceIssued.class);
        InvoiceIssued secondInvoice = single(second, InvoiceIssued.class);
        String prefix = jdbcClient.sql("SELECT financial_year FROM invoice_sequences").query(String.class).single();
        assertThat(firstInvoice.getInvoiceNumber()).isEqualTo("INV/" + prefix + "/000001");
        assertThat(secondInvoice.getInvoiceNumber()).isEqualTo("INV/" + prefix + "/000002");
        // Phase 8: the event carries what the invoice PDF shows.
        assertThat(firstInvoice.getBookingReference()).isNotBlank();
        assertThat(firstInvoice.getBillingName()).isNotBlank();
        assertThat(firstInvoice.getTaxAmount().getAmount()).isEqualByComparingTo("125.00");
        assertThat(firstInvoice.getTaxableAmount().getAmount()).isEqualByComparingTo("2500.00");

        getAs(userId, "/api/invoices/booking/" + first).andExpect(status().isOk())
                .andExpect(jsonPath("$.invoiceNumber").value(firstInvoice.getInvoiceNumber()))
                .andExpect(jsonPath("$.totalAmount").value(2625.00)).andExpect(jsonPath("$.taxAmount").value(125.00))
                .andExpect(jsonPath("$.taxableAmount").value(2500.00)).andExpect(jsonPath("$.billingName").value("Asha Rao"));
        getAs(UUID.randomUUID(), "/api/invoices/booking/" + first).andExpect(status().isNotFound());
        getAs(userId, "/api/invoices").andExpect(jsonPath("$.totalElements").value(2));
        getAs(userId, "/api/payments").andExpect(jsonPath("$.content[?(@.bookingId=='" + first + "')].invoiceNumber")
                .value(firstInvoice.getInvoiceNumber()));
    }

    // ------------------------------------------------------------------ reconciliation

    @Test
    void anOrderNobodyEverPaidIsClosedByTheReconciliationJob() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "1000.00");
        createOrder(userId, bookingId);
        jdbcClient.sql("UPDATE payment_transactions SET created_at = UTC_TIMESTAMP(6) - INTERVAL 2 HOUR "
                + "WHERE booking_id = UUID_TO_BIN(:id)").param("id", bookingId.toString()).update();

        reconciliationJob.reconcile();

        assertThat(paymentStatus(bookingId)).isEqualTo("FAILED");
        assertThat(jdbcClient.sql("SELECT failure_code FROM payment_transactions WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).query(String.class).single()).isEqualTo("ABANDONED");
        // Quiet: the customer never tried to pay, so the booking is not told about a failure.
        assertThat(eventsOf(bookingId, PaymentFailed.class)).isEmpty();
    }

    // ------------------------------------------------------------------ helpers

    private org.springframework.test.web.servlet.ResultActions pay(UUID userId, String orderId) throws Exception {
        String checkout = demo(userId, "pay", orderId);
        return verifyCall(userId, orderId, json(checkout, "$.paymentId"), json(checkout, "$.signature"))
                .andExpect(status().isOk());
    }

    private String demo(UUID userId, String action, String orderId) throws Exception {
        return mockMvc.perform(post("/api/payments/demo/" + action).with(customer(userId))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"orderId\":\"" + orderId + "\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    private String payableStatus(UUID bookingId) {
        return jdbcClient.sql("SELECT status FROM payable_bookings WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).query(String.class).single();
    }

    private UUID paidBooking(UUID userId, String amount) throws Exception {
        UUID bookingId = payable(userId, amount);
        pay(userId, json(createOrder(userId, bookingId), "$.orderId"));
        return bookingId;
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

    private void confirmed(UUID userId, UUID bookingId, String total, String tax) {
        String paymentId = jdbcClient.sql(
                        "SELECT BIN_TO_UUID(id) FROM payment_transactions WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).query(String.class).single();
        bookingEvents.handle(eventId(), BookingConfirmed.newBuilder()
                .setBookingId(bookingId.toString())
                .setBookingReference("HT-" + bookingId.toString().substring(0, 8).toUpperCase())
                .setUserId(userId.toString())
                .setBookingType("HOTEL")
                .setContactEmail("asha@example.com")
                .setCustomerName("Asha Rao")
                .setPaymentId(paymentId)
                .setBaseAmount(EventMoney.of(new BigDecimal(total).subtract(new BigDecimal(tax)), "INR"))
                .setTaxAmount(EventMoney.of(new BigDecimal(tax), "INR"))
                .setDiscountAmount(EventMoney.of(BigDecimal.ZERO, "INR"))
                .setTotalAmount(EventMoney.of(new BigDecimal(total), "INR"))
                .setHotel(ConfirmedHotelStay.newBuilder()
                        .setHotelName("Sea Breeze Resort").setHotelCity("Goa").setHotelAddress("Calangute Beach Road")
                        .setRoomTypeName("Deluxe Sea View").setRatePlanName("Flexible")
                        .setCheckIn(LocalDate.now().plusDays(30)).setCheckOut(LocalDate.now().plusDays(32))
                        .setCheckInTime("14:00").setCheckOutTime("11:00").setNights(2).setRooms(1).setAdults(2)
                        .setChildren(0).setConfirmationNumber("SB123456")
                        .setCancellationPolicy("Free cancellation until 2 days before check-in.").setDemo(true).build())
                .setConfirmedAt(Instant.now())
                .build());
    }
}
