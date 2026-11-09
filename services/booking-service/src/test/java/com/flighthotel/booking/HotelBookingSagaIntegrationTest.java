package com.flighthotel.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import com.flighthotel.booking.service.BookingSaga;
import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingAwaitingPayment;
import com.flighthotel.events.booking.BookingCompleted;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.BookingExpired;
import com.flighthotel.events.booking.BookingFailed;
import com.flighthotel.events.booking.BookingInitiated;
import com.flighthotel.events.booking.BookingPaid;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.hotel.HotelInventoryHoldFailed;
import com.flighthotel.events.hotel.HotelInventoryReleased;
import com.flighthotel.events.hotel.HotelReservationConfirmed;
import com.flighthotel.events.hotel.HotelReservationFailed;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.RefundCompleted;
import com.jayway.jsonpath.JsonPath;

/**
 * Phase 5 exit check, booking side: the hotel booking saga of BOOKING_WORKFLOW.md §2 including every failure path.
 * hotel-service's and payment-service's answers are fed to the real listeners; booking-service's own events are read
 * back from the outbox.
 */
class HotelBookingSagaIntegrationTest extends BookingIntegrationTest {

    @Autowired
    BookingSaga saga;

    // ------------------------------------------------------------------ submitting

    @Test
    void submittingIsIdempotentPerKey() throws Exception {
        UUID me = UUID.randomUUID();
        UUID quote = UUID.randomUUID();
        String key = "key-" + UUID.randomUUID();

        String first = mockMvc.perform(post("/api/bookings/hotel").with(customer(me)).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(bookingRequest(quote, null, 2)))
                .andExpect(status().isAccepted())
                .andExpect(header().exists("Location"))
                .andExpect(jsonPath("$.status").value("INITIATED"))
                .andExpect(jsonPath("$.paymentStatus").value("UNPAID"))
                .andExpect(jsonPath("$.reference").value(org.hamcrest.Matchers.matchesPattern("HT-[2-9A-HJ-NP-Z]{8}")))
                .andExpect(jsonPath("$.contactEmail").value("asha@example.com"))
                .andExpect(jsonPath("$.hotel.quoteId").value(quote.toString()))
                .andExpect(jsonPath("$.hotel.guests.length()").value(2))
                .andExpect(jsonPath("$.canPay").value(false))
                .andReturn().getResponse().getContentAsString();
        UUID bookingId = UUID.fromString(JsonPath.read(first, "$.id"));

        // Double click / retry: the same booking, no second BookingInitiated.
        mockMvc.perform(post("/api/bookings/hotel").with(customer(me)).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(bookingRequest(quote, null, 2)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.id").value(bookingId.toString()));
        BookingInitiated initiated = single(bookingId, BookingInitiated.class);
        assertThat(initiated.getHotel().getQuoteId()).isEqualTo(quote.toString());
        assertThat(initiated.getHotel().getGuests()).hasSize(2);
        assertThat(initiated.getHotel().getSpecialRequests()).isEqualTo("Late arrival");

        // Same key, different request: refused.
        mockMvc.perform(post("/api/bookings/hotel").with(customer(me)).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(bookingRequest(UUID.randomUUID(), null, 2)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REUSED"));
        // Another customer may use the same key value.
        mockMvc.perform(post("/api/bookings/hotel").with(customer(UUID.randomUUID())).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(bookingRequest(quote, null, 2)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.id").value(org.hamcrest.Matchers.not(bookingId.toString())));
    }

    @Test
    void submittingNeedsALoginAKeyAndValidGuests() throws Exception {
        String body = bookingRequest(UUID.randomUUID(), null, 1);
        mockMvc.perform(post("/api/bookings/hotel").header("Idempotency-Key", "key-12345678")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/bookings/hotel").with(customer(UUID.randomUUID()))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));
        mockMvc.perform(post("/api/bookings/hotel").with(customer(UUID.randomUUID())).header("Idempotency-Key", "bad key!")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(post("/api/bookings/hotel").with(customer(UUID.randomUUID())).header("Idempotency-Key", "key-12345678")
                        .contentType(MediaType.APPLICATION_JSON).content("""
                                {"quoteId":"%s","contact":{"email":"not-an-email","phone":"12"},"guests":[]}"""
                                .formatted(UUID.randomUUID())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mockMvc.perform(post("/api/bookings/hotel").with(customer(UUID.randomUUID())).header("Idempotency-Key", "key-12345678")
                        .contentType(MediaType.APPLICATION_JSON).content(body.replace("\"roomNo\":1", "\"roomNo\":2")))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_GUESTS"));
    }

    // ------------------------------------------------------------------ happy path

    @Test
    void heldPaidConfirmed() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, null);

        held(bookingId, "Goa", "6000.00");

        String pending = details(me, bookingId);
        assertThat((String) JsonPath.read(pending, "$.status")).isEqualTo("PENDING_PAYMENT");
        assertThat((Double) JsonPath.read(pending, "$.totalAmount")).isEqualTo(6300.0);
        assertThat((Boolean) JsonPath.read(pending, "$.canPay")).isTrue();
        assertThat((String) JsonPath.read(pending, "$.title")).isEqualTo("Sea Breeze Resort");
        assertThat((List<String>) JsonPath.read(pending, "$.priceItems[*].label"))
                .containsExactly("Room charges · 2 nights × 1 room", "GST 5%");
        assertThat((Object) JsonPath.read(pending, "$.hotel.confirmationNumber")).isNull();
        Instant holdEnd = Instant.parse(JsonPath.read(pending, "$.holdExpiresAt"));
        Instant deadline = Instant.parse(JsonPath.read(pending, "$.paymentDeadline"));
        assertThat(Duration.between(deadline, holdEnd)).isEqualTo(Duration.ofMinutes(5));
        BookingAwaitingPayment awaiting = single(bookingId, BookingAwaitingPayment.class);
        assertThat(awaiting.getAmount().getAmount()).isEqualByComparingTo("6300.00");
        assertThat(awaiting.getDescription()).isEqualTo("Sea Breeze Resort · 2 nights · 1 room");

        UUID paymentId = UUID.randomUUID();
        paymentSucceeded(bookingId, paymentId, "6300.00");

        assertThat((String) JsonPath.read(details(me, bookingId), "$.status")).isEqualTo("SUPPLIER_PENDING");
        assertThat(single(bookingId, BookingPaid.class).getPaymentId()).isEqualTo(paymentId.toString());

        hotelEvents.handle(eventId(), HotelReservationConfirmed.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setConfirmationNumber("HK7M3Q9P2X")
                .setConfirmedAt(Instant.now()).build());

        String confirmed = details(me, bookingId);
        assertThat((String) JsonPath.read(confirmed, "$.status")).isEqualTo("CONFIRMED");
        assertThat((String) JsonPath.read(confirmed, "$.paymentStatus")).isEqualTo("PAID");
        assertThat((String) JsonPath.read(confirmed, "$.hotel.confirmationNumber")).isEqualTo("HK7M3Q9P2X");
        BookingConfirmed event = single(bookingId, BookingConfirmed.class);
        assertThat(event.getCustomerName()).isEqualTo("Asha Rao");
        assertThat(event.getContactEmail()).isEqualTo("asha@example.com");
        assertThat(event.getTotalAmount().getAmount()).isEqualByComparingTo("6300.00");
        assertThat(event.getHotel().getConfirmationNumber()).isEqualTo("HK7M3Q9P2X");
        // Phase 8: when the stay starts (here the hold had no time zone, so check-in 14:00 is read as India time).
        assertThat(event.getStartsAt()).isEqualTo(event.getHotel().getCheckIn().atTime(14, 0)
                .atZone(java.time.ZoneId.of("Asia/Kolkata")).toInstant());

        mockMvc.perform(get("/api/bookings/" + bookingId + "/timeline").with(customer(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].status").value(org.hamcrest.Matchers.contains("INITIATED",
                        "PENDING_PAYMENT", "PAYMENT_SUCCESS", "SUPPLIER_PENDING", "CONFIRMED")));
        mockMvc.perform(get("/api/bookings?tab=UPCOMING").with(customer(me)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].reference").exists())
                .andExpect(jsonPath("$.content[0].demo").value(true));
        mockMvc.perform(get("/api/bookings?tab=PENDING").with(customer(me)))
                .andExpect(jsonPath("$.totalElements").value(0));

        // My Trips search and type filter, and the stay facts on the card (Phase 12).
        String reference = JsonPath.read(mockMvc.perform(get("/api/bookings?tab=UPCOMING").with(customer(me)))
                .andReturn().getResponse().getContentAsString(), "$.content[0].reference");
        mockMvc.perform(get("/api/bookings?q=" + reference.toLowerCase() + "&type=HOTEL").with(customer(me)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].stay.hotelName").isNotEmpty())
                .andExpect(jsonPath("$.content[0].stay.nights").isNumber())
                .andExpect(jsonPath("$.content[0].flight").doesNotExist());
        mockMvc.perform(get("/api/bookings?q=" + reference + "&type=FLIGHT").with(customer(me)))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/bookings?q=no-such-trip").with(customer(me)))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/bookings?q=%25").with(customer(me)))   // a lone % is text, not "everything"
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/bookings?q=" + reference).with(customer(UUID.randomUUID())))
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    // ------------------------------------------------------------------ failures before payment

    @Test
    void holdFailuresEndTheBookingWithAReason() throws Exception {
        UUID me = UUID.randomUUID();
        UUID expired = submit(me, null);
        UUID soldOut = submit(me, null);
        UUID priceChanged = submit(me, null);

        holdFailed(expired, "QUOTE_EXPIRED", "The price you selected has expired.", null);
        holdFailed(soldOut, "SOLD_OUT", "These rooms are no longer available for your dates.", null);
        holdFailed(priceChanged, "PRICE_CHANGED", "The price for this stay has changed.", "6615.00");

        assertThat((String) JsonPath.read(details(me, expired), "$.failureReason")).isEqualTo("QUOTE_EXPIRED");
        String sold = details(me, soldOut);
        assertThat((String) JsonPath.read(sold, "$.status")).isEqualTo("FAILED");
        assertThat((String) JsonPath.read(sold, "$.title")).isEqualTo("Sea Breeze Resort");
        assertThat((String) JsonPath.read(details(me, priceChanged), "$.failureMessage"))
                .isEqualTo("The price for this stay has changed. Today's price for the same stay is ₹6,615.");
        assertThat(single(soldOut, BookingFailed.class).getReason()).isEqualTo("SOLD_OUT");
        mockMvc.perform(get("/api/bookings?tab=CANCELLED").with(customer(me)))
                .andExpect(jsonPath("$.totalElements").value(3));
    }

    @Test
    void aFailedPaymentCanBeRetried() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, null);
        held(bookingId, "Goa", "4000.00");

        paymentEvents.handle(eventId(), PaymentFailed.newBuilder().setPaymentId(UUID.randomUUID().toString())
                .setBookingId(bookingId.toString()).setUserId(me.toString()).setProvider("DEMO")
                .setFailureCode("CARD_DECLINED").setFailureReason("Card declined by the bank")
                .setFailedAt(Instant.now()).build());

        String afterFailure = details(me, bookingId);
        assertThat((String) JsonPath.read(afterFailure, "$.status")).isEqualTo("PENDING_PAYMENT");
        assertThat((String) JsonPath.read(afterFailure, "$.paymentStatus")).isEqualTo("PAYMENT_FAILED");
        assertThat((Boolean) JsonPath.read(afterFailure, "$.canPay")).isTrue();
        mockMvc.perform(get("/api/bookings/" + bookingId + "/timeline").with(customer(me)))
                .andExpect(jsonPath("$[2].reason").value("Payment failed: Card declined by the bank. You can try again."));

        paymentSucceeded(bookingId, UUID.randomUUID(), "4200.00");
        assertThat((String) JsonPath.read(details(me, bookingId), "$.status")).isEqualTo("SUPPLIER_PENDING");
    }

    // ------------------------------------------------------------------ the customer does not pay in time

    @Test
    void anUnpaidBookingExpiresWhenTheHotelReleasesTheRooms() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, null);
        held(bookingId, "Goa", "4000.00");

        released(bookingId, "EXPIRED");

        String expired = details(me, bookingId);
        assertThat((String) JsonPath.read(expired, "$.status")).isEqualTo("EXPIRED");
        assertThat((Boolean) JsonPath.read(expired, "$.canPay")).isFalse();
        assertThat(single(bookingId, BookingExpired.class)).isNotNull();
    }

    @Test
    void aPaymentAfterExpiryIsRefundedInFull() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, null);
        held(bookingId, "Goa", "4000.00");
        released(bookingId, "EXPIRED");
        UUID paymentId = UUID.randomUUID();

        paymentSucceeded(bookingId, paymentId, "4200.00");

        String refunding = details(me, bookingId);
        assertThat((String) JsonPath.read(refunding, "$.status")).isEqualTo("REFUND_PENDING");
        assertThat((String) JsonPath.read(refunding, "$.paymentStatus")).isEqualTo("REFUND_PENDING");
        BookingRefundRequested refund = single(bookingId, BookingRefundRequested.class);
        assertThat(refund.getReason()).isEqualTo("LATE_PAYMENT");
        assertThat(refund.getPaymentId()).isEqualTo(paymentId.toString());
        assertThat(refund.getAmount().getAmount()).isEqualByComparingTo("4200.00");
        assertThat(refund.getCustomerName()).isEqualTo("Asha Rao");
        assertThat(eventTypes(bookingId)).doesNotContain("BookingPaid");

        refundCompleted(refund);

        String refunded = details(me, bookingId);
        assertThat((String) JsonPath.read(refunded, "$.status")).isEqualTo("REFUNDED");
        assertThat((String) JsonPath.read(refunded, "$.paymentStatus")).isEqualTo("REFUNDED");
    }

    @Test
    void aPaymentJustBeforeTheHoldEndedWaitsForTheHotelInsteadOfExpiring() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, null);
        held(bookingId, "Goa", "4000.00");
        paymentSucceeded(bookingId, UUID.randomUUID(), "4200.00");

        // The hold ran out while BookingPaid was on its way; hotel-service answers BookingPaid next.
        released(bookingId, "EXPIRED");

        assertThat((String) JsonPath.read(details(me, bookingId), "$.status")).isEqualTo("SUPPLIER_PENDING");
        assertThat(eventTypes(bookingId)).doesNotContain("BookingExpired");
    }

    @Test
    void theHotelCannotConfirmAfterPaymentSoTheCustomerIsRefunded() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, null);
        held(bookingId, "Goa", "4000.00");
        UUID paymentId = UUID.randomUUID();
        paymentSucceeded(bookingId, paymentId, "4200.00");

        hotelEvents.handle(eventId(), HotelReservationFailed.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setReason("ROOMS_RELEASED")
                .setFailedAt(Instant.now()).build());

        String refunding = details(me, bookingId);
        assertThat((String) JsonPath.read(refunding, "$.status")).isEqualTo("REFUND_PENDING");
        assertThat((Object) JsonPath.read(refunding, "$.hotel.confirmationNumber")).isNull();
        BookingRefundRequested refund = single(bookingId, BookingRefundRequested.class);
        assertThat(refund.getReason()).isEqualTo("BOOKING_FAILED");
        assertThat(refund.getPaymentId()).isEqualTo(paymentId.toString());
        assertThat(refund.getAmount().getAmount()).isEqualByComparingTo("4200.00");
    }

    // ------------------------------------------------------------------ duplicates

    @Test
    void aSecondPaymentIsRefundedAndTheBookingStaysConfirmed() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, null);
        held(bookingId, "Goa", "4000.00");
        UUID first = UUID.randomUUID();
        paymentSucceeded(bookingId, first, "4200.00");
        hotelEvents.handle(eventId(), HotelReservationConfirmed.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setConfirmationNumber("HAAAA22222")
                .setConfirmedAt(Instant.now()).build());

        paymentSucceeded(bookingId, first, "4200.00");
        assertThat(eventTypes(bookingId)).doesNotContain("BookingRefundRequested");

        UUID second = UUID.randomUUID();
        paymentSucceeded(bookingId, second, "4200.00");

        String booking = details(me, bookingId);
        assertThat((String) JsonPath.read(booking, "$.status")).isEqualTo("CONFIRMED");
        assertThat((String) JsonPath.read(booking, "$.paymentStatus")).isEqualTo("PAID");
        BookingRefundRequested refund = single(bookingId, BookingRefundRequested.class);
        assertThat(refund.getReason()).isEqualTo("DUPLICATE_PAYMENT");
        assertThat(refund.getPaymentId()).isEqualTo(second.toString());

        refundCompleted(refund);
        assertThat((String) JsonPath.read(details(me, bookingId), "$.status")).isEqualTo("CONFIRMED");
    }

    @Test
    void duplicateAndLateEventsAreIgnored() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, null);
        String eventId = eventId();
        var heldEvent = heldEvent(bookingId, "Goa", new BigDecimal("4000.00"), LocalDate.now().plusDays(30));

        hotelEvents.handle(eventId, heldEvent);
        hotelEvents.handle(eventId, heldEvent);
        hotelEvents.handle(eventId(), heldEvent);

        assertThat(eventTypes(bookingId)).containsExactly("BookingInitiated", "BookingAwaitingPayment");
        mockMvc.perform(get("/api/bookings/" + bookingId + "/timeline").with(customer(me)))
                .andExpect(jsonPath("$.length()").value(2));
    }

    // ------------------------------------------------------------------ jobs

    @Test
    void aBookingTheHotelNeverAnswersFailsAfterTheTimeout() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, null);
        assertThat(saga.failUnanswered(bookingId)).isFalse();
        jdbcClient.sql("UPDATE bookings SET created_at = UTC_TIMESTAMP(6) - INTERVAL 11 MINUTE WHERE id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).update();

        assertThat(saga.failUnanswered(bookingId)).isTrue();

        assertThat((String) JsonPath.read(details(me, bookingId), "$.failureReason")).isEqualTo("NO_RESPONSE");
        assertThat(single(bookingId, BookingFailed.class).getReason()).isEqualTo("NO_RESPONSE");
        // If hotel-service holds the rooms after all, the answer is ignored (it releases them on BookingFailed).
        held(bookingId, "Goa", "4000.00");
        assertThat((String) JsonPath.read(details(me, bookingId), "$.status")).isEqualTo("FAILED");
    }

    @Test
    void aConfirmedStayIsCompletedAfterCheckOut() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, null);
        hotelEvents.handle(eventId(), heldEvent(bookingId, "Goa", new BigDecimal("4000.00"), LocalDate.now().minusDays(3)));
        paymentSucceeded(bookingId, UUID.randomUUID(), "4200.00");
        hotelEvents.handle(eventId(), HotelReservationConfirmed.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setConfirmationNumber("HBBBB33333")
                .setConfirmedAt(Instant.now()).build());

        assertThat(saga.complete(bookingId)).isTrue();

        assertThat((String) JsonPath.read(details(me, bookingId), "$.status")).isEqualTo("COMPLETED");
        assertThat(single(bookingId, BookingCompleted.class)).isNotNull();
        mockMvc.perform(get("/api/bookings?tab=COMPLETED").with(customer(me)))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    // ------------------------------------------------------------------ access

    @Test
    void customersOnlySeeTheirOwnBookings() throws Exception {
        UUID owner = UUID.randomUUID();
        UUID bookingId = submit(owner, null);

        mockMvc.perform(get("/api/bookings/" + bookingId).with(customer(UUID.randomUUID())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOOKING_NOT_FOUND"));
        mockMvc.perform(get("/api/bookings/" + bookingId + "/timeline").with(customer(UUID.randomUUID())))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/bookings").with(customer(UUID.randomUUID())))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/bookings/" + bookingId).with(supportAgent()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(bookingId.toString()));
        mockMvc.perform(get("/api/bookings/" + bookingId)).andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------------ helpers

    private void holdFailed(UUID bookingId, String reason, String message, String newTotal) {
        hotelEvents.handle(eventId(), HotelInventoryHoldFailed.newBuilder().setBookingId(bookingId.toString())
                .setReason(reason).setMessage(message)
                .setNewTotal(newTotal == null ? null : EventMoney.of(new BigDecimal(newTotal), "INR"))
                .setHotelName("QUOTE_EXPIRED".equals(reason) ? null : "Sea Breeze Resort")
                .setFailedAt(Instant.now()).build());
    }

    private void released(UUID bookingId, String reason) {
        hotelEvents.handle(eventId(), HotelInventoryReleased.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setReason(reason).setReleasedAt(Instant.now()).build());
    }

    private void refundCompleted(BookingRefundRequested refund) {
        paymentEvents.handle(eventId(), RefundCompleted.newBuilder().setRefundId(UUID.randomUUID().toString())
                .setRefundRequestId(refund.getRefundRequestId()).setPaymentId(refund.getPaymentId())
                .setBookingId(refund.getBookingId()).setUserId(refund.getUserId()).setAmount(refund.getAmount())
                .setCompletedAt(Instant.now()).build());
    }
}
