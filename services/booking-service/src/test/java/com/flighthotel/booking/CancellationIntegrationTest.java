package com.flighthotel.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.UnaryOperator;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.web.servlet.ResultActions;

import com.flighthotel.booking.messaging.FlightEventsListener;
import com.flighthotel.booking.scheduler.BookingJobs;
import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.audit.AuditEventRecorded;
import com.flighthotel.events.booking.BookingCancellationFailed;
import com.flighthotel.events.booking.BookingCancellationRequested;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.common.FlightSegmentInfo;
import com.flighthotel.events.common.FlightSlice;
import com.flighthotel.events.flight.FlightBookingCancelled;
import com.flighthotel.events.flight.FlightBookingConfirmed;
import com.flighthotel.events.flight.FlightCancellationFailed;
import com.flighthotel.events.flight.FlightOfferHeld;
import com.flighthotel.events.flight.FlightPriceLine;
import com.flighthotel.events.flight.FlightTicketInfo;
import com.flighthotel.events.hotel.HotelInventoryHeld;
import com.flighthotel.events.hotel.HotelReservationCancellationFailed;
import com.flighthotel.events.hotel.HotelReservationCancelled;
import com.flighthotel.events.hotel.HotelReservationConfirmed;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.events.payment.RefundFailed;
import com.jayway.jsonpath.JsonPath;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;

/**
 * Phase 7 exit check, booking side: cancellations and refunds of BOOKING_WORKFLOW.md section 4. Fees by the booked
 * policy (free period, partial, non-refundable, the airline's own fee), partial refunds, refusals by the hotel or
 * airline, support agents acting for the customer, failed refunds, and reconciliation of unanswered requests.
 */
class CancellationIntegrationTest extends BookingIntegrationTest {

    private static final KafkaAvroDeserializer AVRO = new KafkaAvroDeserializer();

    static {
        AVRO.configure(Map.of("schema.registry.url", "mock://booking-it", "specific.avro.reader", true), false);
    }

    @Autowired
    FlightEventsListener flightEvents;

    @Autowired
    BookingJobs jobs;

    // ------------------------------------------------------------------ hotel: fees and refunds

    @Test
    void aStayCancelledInTheFreePeriodIsRefundedInFull() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = confirmedStay(me, null, UnaryOperator.identity());

        mockMvc.perform(get("/api/bookings/" + bookingId + "/cancellation-quote").with(customer(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingId").value(bookingId.toString()))
                .andExpect(jsonPath("$.cancellable").value(true))
                .andExpect(jsonPath("$.freeCancellation").value(true))
                .andExpect(jsonPath("$.paidAmount").value(6300.0))
                .andExpect(jsonPath("$.cancellationFee").value(0.0))
                .andExpect(jsonPath("$.refundAmount").value(6300.0))
                .andExpect(jsonPath("$.cancelUntil").exists())
                .andExpect(jsonPath("$.policy").value(Matchers.startsWith("Free cancellation")));
        assertThat((Boolean) JsonPath.read(details(me, bookingId), "$.canCancel")).isTrue();

        String key = "cancel-" + UUID.randomUUID();
        String cancellation = cancel(me, bookingId, key, "{\"reason\":\"Change of plans\",\"expectedRefundAmount\":6300}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.initiatedBy").value("CUSTOMER"))
                .andExpect(jsonPath("$.refundAmount").value(6300.0))
                .andReturn().getResponse().getContentAsString();
        String cancellationId = JsonPath.read(cancellation, "$.id");

        String pending = details(me, bookingId);
        assertThat((String) JsonPath.read(pending, "$.status")).isEqualTo("CANCELLATION_PENDING");
        assertThat((Boolean) JsonPath.read(pending, "$.canCancel")).isFalse();
        assertThat((String) JsonPath.read(pending, "$.cancellation.status")).isEqualTo("PENDING");
        BookingCancellationRequested requested = single(bookingId, BookingCancellationRequested.class);
        assertThat(requested.getCancellationId()).isEqualTo(cancellationId);
        assertThat(requested.getBookingType()).isEqualTo("HOTEL");
        assertThat(requested.getInitiatedBy()).isEqualTo("CUSTOMER");

        // Double click: the same cancellation; the same key for something else: refused.
        cancel(me, bookingId, key, "{\"reason\":\"Change of plans\",\"expectedRefundAmount\":6300}")
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.id").value(cancellationId));
        cancel(me, bookingId, key, "{\"reason\":\"Other\",\"expectedRefundAmount\":6300}")
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REUSED"));
        assertThat(eventsOfType(bookingId, BookingCancellationRequested.class)).hasSize(1);

        hotelCancelled(bookingId, cancellationId, "HXK7M3Q9P2");
        // The hotel repeats its answer (it was asked again): nothing happens twice.
        hotelCancelled(bookingId, cancellationId, "HXK7M3Q9P2");

        BookingCancelled cancelled = single(bookingId, BookingCancelled.class);
        assertThat(cancelled.getCancellationFee().getAmount()).isEqualByComparingTo("0");
        assertThat(cancelled.getRefundAmount().getAmount()).isEqualByComparingTo("6300.00");
        assertThat(cancelled.getSupplierReference()).isEqualTo("HXK7M3Q9P2");
        assertThat(cancelled.getCustomerName()).isEqualTo("Asha Rao");
        BookingRefundRequested refund = single(bookingId, BookingRefundRequested.class);
        assertThat(refund.getReason()).isEqualTo("CANCELLATION");
        assertThat(refund.getAmount().getAmount()).isEqualByComparingTo("6300.00");
        String refunding = details(me, bookingId);
        assertThat((String) JsonPath.read(refunding, "$.status")).isEqualTo("REFUND_PENDING");
        assertThat((String) JsonPath.read(refunding, "$.paymentStatus")).isEqualTo("REFUND_PENDING");
        // Still visible after the cancellation: the hotel's confirmation number (it was confirmed once).
        assertThat((String) JsonPath.read(refunding, "$.hotel.confirmationNumber")).isEqualTo("HK7M3Q9P2X");

        refundCompleted(bookingId, refund);
        // payment-service repeats its answer (reconciliation): the money is counted once.
        refundCompleted(bookingId, refund);

        String refunded = details(me, bookingId);
        assertThat((String) JsonPath.read(refunded, "$.status")).isEqualTo("REFUNDED");
        assertThat((String) JsonPath.read(refunded, "$.paymentStatus")).isEqualTo("REFUNDED");
        assertThat((Double) JsonPath.read(refunded, "$.refundedAmount")).isEqualTo(6300.0);
        assertThat((String) JsonPath.read(refunded, "$.cancellation.status")).isEqualTo("CONFIRMED");
        assertThat((String) JsonPath.read(refunded, "$.cancellation.supplierReference")).isEqualTo("HXK7M3Q9P2");
        assertThat((List<String>) JsonPath.read(refunded, "$.refunds[*].status")).containsExactly("COMPLETED");
        assertThat((Object) JsonPath.read(refunded, "$.attention")).isNull();
        assertThat((List<Object>) JsonPath.read(refunded, "$.supportNotes")).isEmpty();
        mockMvc.perform(get("/api/bookings/" + bookingId + "/timeline").with(customer(me)))
                .andExpect(jsonPath("$[*].status").value(Matchers.contains("INITIATED", "PENDING_PAYMENT",
                        "PAYMENT_SUCCESS", "SUPPLIER_PENDING", "CONFIRMED", "CANCELLATION_PENDING", "CANCELLED",
                        "REFUND_PENDING", "REFUNDED")));
        mockMvc.perform(get("/api/bookings?tab=CANCELLED").with(customer(me)))
                .andExpect(jsonPath("$.content[0].id").value(bookingId.toString()))
                .andExpect(jsonPath("$.content[0].canCancel").value(false));
        assertThat(auditActions(bookingId)).containsExactly("BOOKING_CANCELLATION_REQUESTED", "BOOKING_CANCELLED",
                "BOOKING_REFUND_REQUESTED", "BOOKING_REFUND_COMPLETED");
        assertThat(audit(bookingId).getFirst().getDetails()).containsEntry("initiatedBy", "CUSTOMER")
                .doesNotContainKey("reason");
    }

    @Test
    void afterTheFreePeriodTheFeeIsKeptAndTheRestIsRefundedButNotTheCouponDiscount() throws Exception {
        UUID me = UUID.randomUUID();
        // 6300 stay price, WELCOME10 takes 630 off: the customer paid 5670. The fee is 50 % of the stay price.
        UUID bookingId = confirmedStay(me, "WELCOME10", held -> HotelInventoryHeld.newBuilder(held)
                .setFreeCancellationUntil(Instant.now().minus(1, ChronoUnit.HOURS)).build());

        mockMvc.perform(get("/api/bookings/" + bookingId + "/cancellation-quote").with(customer(me)))
                .andExpect(jsonPath("$.freeCancellation").value(false))
                .andExpect(jsonPath("$.paidAmount").value(5670.0))
                .andExpect(jsonPath("$.cancellationFee").value(3150.0))
                .andExpect(jsonPath("$.refundAmount").value(2520.0))
                .andExpect(jsonPath("$.feeDescription").value("50% of the stay price (₹6,300)"));

        String cancellationId = JsonPath.read(cancel(me, bookingId, "cancel-" + UUID.randomUUID(),
                "{\"expectedRefundAmount\":2520.00}").andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString(), "$.id");
        hotelCancelled(bookingId, cancellationId, "HXAAAA2222");
        BookingRefundRequested refund = single(bookingId, BookingRefundRequested.class);
        assertThat(refund.getAmount().getAmount()).isEqualByComparingTo("2520.00");
        refundCompleted(bookingId, refund);

        String refunded = details(me, bookingId);
        assertThat((String) JsonPath.read(refunded, "$.status")).isEqualTo("REFUNDED");
        assertThat((String) JsonPath.read(refunded, "$.paymentStatus")).isEqualTo("PARTIALLY_REFUNDED");
        assertThat((Double) JsonPath.read(refunded, "$.refundedAmount")).isEqualTo(2520.0);
        assertThat((Double) JsonPath.read(refunded, "$.cancellation.cancellationFee")).isEqualTo(3150.0);
    }

    @Test
    void aNonRefundableStayIsCancelledWithoutARefund() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = confirmedStay(me, null, held -> HotelInventoryHeld.newBuilder(held).setRefundable(false)
                .setFreeCancellationUntil(null).setCancellationFeePercent(new BigDecimal("100.00"))
                .setCancellationPolicy("Non-refundable: the full amount is charged if you cancel.").build());

        mockMvc.perform(get("/api/bookings/" + bookingId + "/cancellation-quote").with(customer(me)))
                .andExpect(jsonPath("$.cancellable").value(true))
                .andExpect(jsonPath("$.refundAmount").value(0.0))
                .andExpect(jsonPath("$.cancellationFee").value(6300.0))
                .andExpect(jsonPath("$.feeDescription").value(Matchers.startsWith("Non-refundable")));
        String cancellationId = JsonPath.read(cancel(me, bookingId, "cancel-" + UUID.randomUUID(),
                "{\"expectedRefundAmount\":0}").andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString(), "$.id");
        hotelCancelled(bookingId, cancellationId, "HXBBBB3333");

        String cancelled = details(me, bookingId);
        assertThat((String) JsonPath.read(cancelled, "$.status")).isEqualTo("CANCELLED");
        assertThat((String) JsonPath.read(cancelled, "$.paymentStatus")).isEqualTo("PAID");
        assertThat(eventsOfType(bookingId, BookingRefundRequested.class)).isEmpty();
        assertThat(single(bookingId, BookingCancelled.class).getRefundAmount().getAmount()).isEqualByComparingTo("0");
    }

    @Test
    void aQuoteThatChangedWhileThePageWasOpenIsNotHonoured() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = confirmedStay(me, null, held -> HotelInventoryHeld.newBuilder(held)
                .setFreeCancellationUntil(Instant.now().minus(1, ChronoUnit.MINUTES)).build());

        // The customer saw the free refund before the deadline; now the fee applies.
        cancel(me, bookingId, "cancel-" + UUID.randomUUID(), "{\"expectedRefundAmount\":6300}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CANCELLATION_QUOTE_CHANGED"))
                .andExpect(jsonPath("$.details.refundAmount").value(3150.0))
                .andExpect(jsonPath("$.details.cancellationFee").value(3150.0));
        assertThat((String) JsonPath.read(details(me, bookingId), "$.status")).isEqualTo("CONFIRMED");
        assertThat(eventsOfType(bookingId, BookingCancellationRequested.class)).isEmpty();
    }

    @Test
    void onlyConfirmedBookingsBeforeTheDeadlineCanBeCancelledAndOnlyByTheirOwner() throws Exception {
        UUID me = UUID.randomUUID();
        UUID unpaid = submit(me, null);
        held(unpaid, "Goa", "6000.00");
        UUID started = confirmedStay(me, null, held -> HotelInventoryHeld.newBuilder(held)
                .setCheckInAt(Instant.now().minus(1, ChronoUnit.HOURS)).build());

        mockMvc.perform(get("/api/bookings/" + unpaid + "/cancellation-quote").with(customer(me)))
                .andExpect(jsonPath("$.cancellable").value(false))
                .andExpect(jsonPath("$.reasonCode").value("NOT_CONFIRMED"))
                .andExpect(jsonPath("$.refundAmount").value(0.0));
        cancel(me, unpaid, "cancel-" + UUID.randomUUID(), "{}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BOOKING_NOT_CANCELLABLE"))
                .andExpect(jsonPath("$.details.reasonCode").value("NOT_CONFIRMED"));
        // The check-in time has passed.
        mockMvc.perform(get("/api/bookings/" + started + "/cancellation-quote").with(customer(me)))
                .andExpect(jsonPath("$.reasonCode").value("TOO_LATE"))
                .andExpect(jsonPath("$.message").value(Matchers.containsString("check-in time has passed")));
        assertThat((Boolean) JsonPath.read(details(me, started), "$.canCancel")).isFalse();
        cancel(me, started, "cancel-" + UUID.randomUUID(), "{}")
                .andExpect(jsonPath("$.details.reasonCode").value("TOO_LATE"));

        UUID bookingId = confirmedStay(me, null, UnaryOperator.identity());
        UUID stranger = UUID.randomUUID();
        mockMvc.perform(get("/api/bookings/" + bookingId + "/cancellation-quote").with(customer(stranger)))
                .andExpect(status().isNotFound());
        cancel(stranger, bookingId, "cancel-" + UUID.randomUUID(), "{}").andExpect(status().isNotFound());
        mockMvc.perform(post("/api/bookings/" + bookingId + "/cancel").with(customer(me))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));
        mockMvc.perform(post("/api/bookings/" + bookingId + "/cancel").header("Idempotency-Key", "cancel-12345678")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
        // A customer cannot waive the fee.
        mockMvc.perform(get("/api/bookings/" + bookingId + "/cancellation-quote?waiveFee=true").with(customer(me)))
                .andExpect(status().isForbidden());
        cancel(me, bookingId, "cancel-" + UUID.randomUUID(), "{\"waiveFee\":true}").andExpect(status().isForbidden());
        assertThat((String) JsonPath.read(details(me, bookingId), "$.status")).isEqualTo("CONFIRMED");
    }

    @Test
    void theHotelRefusesSoTheBookingStaysConfirmedAndSupportIsAlerted() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = confirmedStay(me, null, UnaryOperator.identity());
        String cancellationId = JsonPath.read(cancel(me, bookingId, "cancel-" + UUID.randomUUID(), "{}")
                .andReturn().getResponse().getContentAsString(), "$.id");

        hotelEvents.handle(eventId(), HotelReservationCancellationFailed.newBuilder().setBookingId(bookingId.toString())
                .setCancellationId(cancellationId).setReason("TOO_LATE")
                .setMessage("The check-in time has passed, so the hotel can no longer cancel this stay.")
                .setFailedAt(Instant.now()).build());

        String refused = details(me, bookingId);
        assertThat((String) JsonPath.read(refused, "$.status")).isEqualTo("CONFIRMED");
        assertThat((String) JsonPath.read(refused, "$.paymentStatus")).isEqualTo("PAID");
        assertThat((String) JsonPath.read(refused, "$.cancellation.status")).isEqualTo("REJECTED");
        assertThat((String) JsonPath.read(refused, "$.cancellation.failureMessage")).contains("check-in time");
        assertThat((Object) JsonPath.read(refused, "$.attention")).isNull();
        BookingCancellationFailed failed = single(bookingId, BookingCancellationFailed.class);
        assertThat(failed.getReason()).isEqualTo("TOO_LATE");
        assertThat(failed.getContactEmail()).isEqualTo("asha@example.com");
        mockMvc.perform(get("/api/bookings/" + bookingId).with(supportAgent()))
                .andExpect(jsonPath("$.attention.reason").value("CANCELLATION_REJECTED"))
                .andExpect(jsonPath("$.attention.note").value(Matchers.startsWith("TOO_LATE")));
        assertThat(auditActions(bookingId)).contains("BOOKING_CANCELLATION_REJECTED");

        // The customer may try again (a new request).
        cancel(me, bookingId, "cancel-" + UUID.randomUUID(), "{}").andExpect(status().isAccepted());
        assertThat((String) JsonPath.read(details(me, bookingId), "$.status")).isEqualTo("CANCELLATION_PENDING");
        // A late answer to the first request is ignored.
        hotelCancelled(bookingId, cancellationId, "HXLATE2222");
        assertThat(eventsOfType(bookingId, BookingCancelled.class)).isEmpty();
    }

    // ------------------------------------------------------------------ flights: the airline's fee is final

    @Test
    void aFlightIsCancelledAtTheAirlinesFeeAndAHigherFeeThanQuotedIsFlagged() throws Exception {
        UUID me = UUID.randomUUID();
        UUID asQuoted = confirmedFlight(me);
        UUID higher = confirmedFlight(me);

        // Fare 4500, taxes and charges 675: 25 % of the fare is kept.
        mockMvc.perform(get("/api/bookings/" + asQuoted + "/cancellation-quote").with(customer(me)))
                .andExpect(jsonPath("$.paidAmount").value(5175.0))
                .andExpect(jsonPath("$.cancellationFee").value(1125.0))
                .andExpect(jsonPath("$.refundAmount").value(4050.0))
                .andExpect(jsonPath("$.feeDescription").value(Matchers.startsWith("25% of the fare (₹4,500)")));

        String first = JsonPath.read(cancel(me, asQuoted, "cancel-" + UUID.randomUUID(), "{\"expectedRefundAmount\":4050}")
                .andReturn().getResponse().getContentAsString(), "$.id");
        String second = JsonPath.read(cancel(me, higher, "cancel-" + UUID.randomUUID(), "{}")
                .andReturn().getResponse().getContentAsString(), "$.id");
        assertThat(single(asQuoted, BookingCancellationRequested.class).getBookingType()).isEqualTo("FLIGHT");

        airlineCancelled(asQuoted, first, "1125.00");
        airlineCancelled(higher, second, "1500.00");

        assertThat(single(asQuoted, BookingRefundRequested.class).getAmount().getAmount())
                .isEqualByComparingTo("4050.00");
        assertThat(single(higher, BookingRefundRequested.class).getAmount().getAmount())
                .isEqualByComparingTo("3675.00");
        assertThat((String) JsonPath.read(details(me, higher), "$.cancellation.supplierReference")).isEqualTo("DXK7M3Q9P2");
        mockMvc.perform(get("/api/bookings/" + asQuoted).with(supportAgent()))
                .andExpect(jsonPath("$.attention").doesNotExist());
        mockMvc.perform(get("/api/bookings/" + higher).with(supportAgent()))
                .andExpect(jsonPath("$.attention.reason").value("REFUND_DIFFERS"))
                .andExpect(jsonPath("$.cancellation.cancellationFee").value(1500.0));
        mockMvc.perform(get("/api/bookings/" + higher + "/timeline").with(customer(me)))
                .andExpect(jsonPath("$[*].reason").value(Matchers.hasItem(Matchers.containsString(
                        "higher than quoted"))));
        // The PNR stays visible on the cancelled trip.
        assertThat((String) JsonPath.read(details(me, asQuoted), "$.flight.pnr")).isEqualTo("K7M2QX");
    }

    @Test
    void theAirlineRefusingOrNotAnsweringLeavesTheTicketsValid() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = confirmedFlight(me);
        String cancellationId = JsonPath.read(cancel(me, bookingId, "cancel-" + UUID.randomUUID(), "{}")
                .andReturn().getResponse().getContentAsString(), "$.id");

        flightEvents.handle(eventId(), FlightCancellationFailed.newBuilder().setBookingId(bookingId.toString())
                .setCancellationId(cancellationId).setReason("SUPPLIER_NO_ANSWER")
                .setMessage("The airline did not confirm the cancellation, so your booking is still valid.")
                .setFailedAt(Instant.now()).build());

        String refused = details(me, bookingId);
        assertThat((String) JsonPath.read(refused, "$.status")).isEqualTo("CONFIRMED");
        assertThat((String) JsonPath.read(refused, "$.cancellation.failureReason")).isEqualTo("SUPPLIER_NO_ANSWER");
        assertThat((Boolean) JsonPath.read(refused, "$.canCancel")).isTrue();
        assertThat(single(bookingId, BookingCancellationFailed.class).getMessage()).contains("still valid");
    }

    // ------------------------------------------------------------------ support agents and admins

    @Test
    void supportCancelsOnBehalfWithAReasonAndOnlyRefundManagersWaiveTheFee() throws Exception {
        UUID me = UUID.randomUUID();
        UUID byAgent = confirmedStay(me, null, held -> HotelInventoryHeld.newBuilder(held)
                .setFreeCancellationUntil(Instant.now().minus(1, ChronoUnit.HOURS)).build());
        UUID byAdmin = confirmedStay(me, null, held -> HotelInventoryHeld.newBuilder(held)
                .setFreeCancellationUntil(Instant.now().minus(1, ChronoUnit.HOURS)).build());
        JwtRequestPostProcessor agent = supportAgent();

        cancelAs(agent, byAgent, "{}").andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("REASON_REQUIRED"));
        cancelAs(agent, byAgent, "{\"reason\":\"Airline strike\",\"waiveFee\":true}").andExpect(status().isForbidden());
        mockMvc.perform(get("/api/bookings/" + byAgent + "/cancellation-quote?waiveFee=true").with(agent))
                .andExpect(status().isForbidden());
        cancelAs(agent, byAgent, "{\"reason\":\"Customer called: wedding postponed\",\"expectedRefundAmount\":3150}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.initiatedBy").value("SUPPORT_AGENT"))
                .andExpect(jsonPath("$.reason").value("Customer called: wedding postponed"));
        mockMvc.perform(get("/api/bookings/" + byAgent).with(agent))
                .andExpect(jsonPath("$.supportNotes[0].action").value("CANCELLED_ON_BEHALF"))
                .andExpect(jsonPath("$.supportNotes[0].authorRole").value("SUPPORT_AGENT"));
        assertThat((List<Object>) JsonPath.read(details(me, byAgent), "$.supportNotes")).isEmpty();
        mockMvc.perform(get("/api/bookings/" + byAgent + "/timeline").with(customer(me)))
                .andExpect(jsonPath("$[-1].reason").value("Cancellation requested by our support team"));

        JwtRequestPostProcessor admin = admin();
        mockMvc.perform(get("/api/bookings/" + byAdmin + "/cancellation-quote?waiveFee=true").with(admin))
                .andExpect(jsonPath("$.feeWaived").value(true))
                .andExpect(jsonPath("$.cancellationFee").value(0.0))
                .andExpect(jsonPath("$.refundAmount").value(6300.0));
        String waived = cancelAs(admin, byAdmin,
                "{\"reason\":\"Hotel overbooked\",\"waiveFee\":true,\"expectedRefundAmount\":6300}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.initiatedBy").value("ADMIN"))
                .andExpect(jsonPath("$.feeWaived").value(true))
                .andReturn().getResponse().getContentAsString();
        hotelCancelled(byAdmin, JsonPath.read(waived, "$.id"), "HXWAIV2222");
        assertThat(single(byAdmin, BookingRefundRequested.class).getAmount().getAmount())
                .isEqualByComparingTo("6300.00");
        assertThat(auditActions(byAdmin)).contains("BOOKING_CANCELLATION_FEE_WAIVED");
        assertThat(single(byAdmin, BookingCancellationRequested.class).getInitiatedBy()).isEqualTo("ADMIN");
    }

    @Test
    void aFailedRefundIsFlaggedAndARefundManagerSendsItAgain() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = confirmedStay(me, null, UnaryOperator.identity());
        String cancellationId = JsonPath.read(cancel(me, bookingId, "cancel-" + UUID.randomUUID(), "{}")
                .andReturn().getResponse().getContentAsString(), "$.id");
        hotelCancelled(bookingId, cancellationId, "HXFAIL2222");
        BookingRefundRequested first = single(bookingId, BookingRefundRequested.class);
        JwtRequestPostProcessor agent = supportAgent();
        mockMvc.perform(post("/api/support/bookings/" + bookingId + "/retry-refund").with(admin()))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("NO_FAILED_REFUND"));

        paymentEvents.handle(eventId(), RefundFailed.newBuilder().setRefundId(UUID.randomUUID().toString())
                .setRefundRequestId(first.getRefundRequestId()).setPaymentId(first.getPaymentId())
                .setBookingId(bookingId.toString()).setUserId(me.toString()).setAmount(first.getAmount())
                .setReason("Provider refused").setFailedAt(Instant.now()).build());

        mockMvc.perform(get("/api/bookings/" + bookingId).with(agent))
                .andExpect(jsonPath("$.status").value("REFUND_PENDING"))
                .andExpect(jsonPath("$.attention.reason").value("REFUND_FAILED"))
                .andExpect(jsonPath("$.refunds[0].status").value("FAILED"));
        mockMvc.perform(get("/api/support/bookings?attention=true").with(agent))
                .andExpect(jsonPath("$.content[*].id").value(Matchers.hasItem(bookingId.toString())));
        // Support agents escalate; only refund managers send money again.
        mockMvc.perform(post("/api/support/bookings/" + bookingId + "/retry-refund").with(agent))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/support/bookings/" + bookingId + "/retry-refund").with(admin()))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.amount").value(6300.0))
                .andExpect(jsonPath("$.status").value("REQUESTED"));
        List<BookingRefundRequested> requests = eventsOfType(bookingId, BookingRefundRequested.class);
        assertThat(requests).hasSize(2);
        BookingRefundRequested retry = requests.getLast();
        assertThat(retry.getRefundRequestId()).isNotEqualTo(first.getRefundRequestId());
        mockMvc.perform(get("/api/bookings/" + bookingId).with(agent))
                .andExpect(jsonPath("$.attention").doesNotExist())
                .andExpect(jsonPath("$.supportNotes[*].action").value(Matchers.hasItem("REFUND_RETRIED")));

        refundCompleted(bookingId, retry);
        String refunded = details(me, bookingId);
        assertThat((String) JsonPath.read(refunded, "$.status")).isEqualTo("REFUNDED");
        assertThat((Double) JsonPath.read(refunded, "$.refundedAmount")).isEqualTo(6300.0);
        assertThat(auditActions(bookingId)).contains("BOOKING_REFUND_FAILED", "BOOKING_REFUND_RETRIED");
    }

    @Test
    void supportFindsBookingsAndKeepsTheNeedsAttentionQueue() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = confirmedStay(me, null, UnaryOperator.identity());
        String reference = JsonPath.read(details(me, bookingId), "$.reference");
        JwtRequestPostProcessor agent = supportAgent();

        mockMvc.perform(get("/api/support/bookings?q=" + reference.toLowerCase()).with(agent))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].reference").value(reference))
                .andExpect(jsonPath("$.content[0].leadName").value("Asha Rao"))
                .andExpect(jsonPath("$.content[0].contactEmail").value("asha@example.com"));
        mockMvc.perform(get("/api/support/bookings?q=HK7M3Q9P2X&type=HOTEL&status=CONFIRMED").with(agent))
                .andExpect(jsonPath("$.content[*].id").value(Matchers.hasItem(bookingId.toString())));
        mockMvc.perform(get("/api/support/bookings?q=ASHA@example.com&size=50").with(agent))
                .andExpect(jsonPath("$.content[*].id").value(Matchers.hasItem(bookingId.toString())));
        mockMvc.perform(get("/api/support/bookings?q=" + reference).with(customer(me)))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/support/bookings/" + bookingId + "/resolve").with(agent))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("NOTHING_TO_RESOLVE"));
        mockMvc.perform(post("/api/support/bookings/" + bookingId + "/escalate").with(agent)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"note\":\"\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/support/bookings/" + bookingId + "/escalate").with(agent)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"note\":\"Customer disputes the fee\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reason").value("ESCALATED"))
                .andExpect(jsonPath("$.since").exists());
        mockMvc.perform(get("/api/support/bookings?attention=true&size=50").with(agent))
                .andExpect(jsonPath("$.content[*].id").value(Matchers.hasItem(bookingId.toString())));
        mockMvc.perform(post("/api/support/bookings/" + bookingId + "/escalate").with(customer(me))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"note\":\"Please\"}"))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/support/bookings/" + bookingId + "/resolve").with(agent)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"note\":\"Explained the policy\"}"))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/bookings/" + bookingId).with(agent))
                .andExpect(jsonPath("$.attention").doesNotExist())
                .andExpect(jsonPath("$.supportNotes[*].action").value(Matchers.contains("ESCALATED", "RESOLVED")))
                .andExpect(jsonPath("$.supportNotes[1].note").value("Explained the policy"));
        // Internal notes never reach the customer's timeline or the audit log.
        mockMvc.perform(get("/api/bookings/" + bookingId + "/timeline").with(customer(me)))
                .andExpect(jsonPath("$[*].reason").value(Matchers.not(Matchers.hasItem(
                        Matchers.containsString("disputes")))));
        assertThat(audit(bookingId)).extracting(AuditEventRecorded::getAction)
                .contains("BOOKING_ESCALATED", "BOOKING_ATTENTION_RESOLVED");
        assertThat(audit(bookingId)).allSatisfy(event -> assertThat(event.getDetails().values())
                .noneMatch(value -> value.contains("disputes") || value.contains("Explained")));
    }

    // ------------------------------------------------------------------ reconciliation

    @Test
    void unansweredCancellationsAndRefundsAreAskedAgainThenFlagged() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = confirmedStay(me, null, UnaryOperator.identity());
        String cancellationId = JsonPath.read(cancel(me, bookingId, "cancel-" + UUID.randomUUID(), "{}")
                .andReturn().getResponse().getContentAsString(), "$.id");

        // Too early: nothing is sent again.
        jobs.reconcileCancellationsAndRefunds();
        assertThat(eventsOfType(bookingId, BookingCancellationRequested.class)).hasSize(1);
        for (int attempt = 2; attempt <= 3; attempt++) {
            age("cancellations", "id", cancellationId);
            jobs.reconcileCancellationsAndRefunds();
            assertThat(eventsOfType(bookingId, BookingCancellationRequested.class)).hasSize(attempt)
                    .extracting(BookingCancellationRequested::getCancellationId).containsOnly(cancellationId);
        }
        age("cancellations", "id", cancellationId);
        jobs.reconcileCancellationsAndRefunds();
        assertThat(eventsOfType(bookingId, BookingCancellationRequested.class)).hasSize(3);
        mockMvc.perform(get("/api/bookings/" + bookingId).with(supportAgent()))
                .andExpect(jsonPath("$.attention.reason").value("CANCELLATION_NO_ANSWER"));

        // The hotel finally answers: cancelled, and the flag goes away by itself.
        hotelCancelled(bookingId, cancellationId, "HXSLOW2222");
        mockMvc.perform(get("/api/bookings/" + bookingId).with(supportAgent()))
                .andExpect(jsonPath("$.status").value("REFUND_PENDING"))
                .andExpect(jsonPath("$.attention").doesNotExist());

        BookingRefundRequested refund = single(bookingId, BookingRefundRequested.class);
        age("booking_refund_requests", "id", refund.getRefundRequestId());
        jobs.reconcileCancellationsAndRefunds();
        List<BookingRefundRequested> refunds = eventsOfType(bookingId, BookingRefundRequested.class);
        assertThat(refunds).hasSize(2).extracting(BookingRefundRequested::getRefundRequestId)
                .containsOnly(refund.getRefundRequestId());
    }

    // ------------------------------------------------------------------ helpers

    private static JwtRequestPostProcessor admin() {
        return user(UUID.randomUUID(), Set.of("ADMIN"), Set.of("BOOKING_READ_ANY", "BOOKING_MANAGE_ANY",
                "PAYMENT_READ_ANY", "REFUND_MANAGE"));
    }

    /** Held (stay price 6300, 50 % fee after a free period ending in 28 days), paid and confirmed by the hotel. */
    private UUID confirmedStay(UUID userId, String coupon, UnaryOperator<HotelInventoryHeld> terms) throws Exception {
        UUID bookingId = submit(userId, coupon);
        hotelEvents.handle(eventId(), terms.apply(heldEvent(bookingId, "Goa", new BigDecimal("6000.00"),
                LocalDate.now().plusDays(30))));
        Double total = JsonPath.read(details(userId, bookingId), "$.totalAmount");
        paymentSucceeded(bookingId, UUID.randomUUID(), BigDecimal.valueOf(total).setScale(2).toPlainString());
        hotelEvents.handle(eventId(), HotelReservationConfirmed.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setConfirmationNumber("HK7M3Q9P2X")
                .setConfirmedAt(Instant.now()).build());
        assertThat((String) JsonPath.read(details(userId, bookingId), "$.status")).isEqualTo("CONFIRMED");
        return bookingId;
    }

    /** DEL to BOM in 30 days: fare 4500 + taxes and charges 675, Economy Flex (25 % fee), issued by the airline. */
    private UUID confirmedFlight(UUID userId) throws Exception {
        String body = mockMvc.perform(post("/api/bookings/flight").with(customer(userId))
                        .header("Idempotency-Key", "key-" + UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tripOfferId":"%s","contact":{"email":"asha@example.com","phone":"+91 98000 00000"},
                                 "passengers":[{"passengerType":"ADULT","firstName":"Asha","lastName":"Rao"}]}"""
                                .formatted(UUID.randomUUID())))
                .andExpect(status().isAccepted()).andReturn().getResponse().getContentAsString();
        UUID bookingId = UUID.fromString(JsonPath.read(body, "$.id"));
        LocalDate day = LocalDate.now().plusDays(30);
        BigDecimal fare = new BigDecimal("4500.00");
        BigDecimal taxes = new BigDecimal("675.00");
        Instant now = Instant.now();
        flightEvents.handle(eventId(), FlightOfferHeld.newBuilder()
                .setBookingId(bookingId.toString()).setHoldId(UUID.randomUUID().toString()).setProvider("DEMO")
                .setDemo(true).setTitle("Delhi to Mumbai").setTripType("ONE_WAY").setCabin("ECONOMY")
                .setFareName("Economy Flex").setRefundable(true).setCheckedBaggageKg(20).setCabinBaggageKg(7)
                .setCancellationFeePercent(25)
                .setCancellationPolicy("Cancel up to 4 hours before departure for a fee of 25% of the fare.")
                .setSlices(List.of(FlightSlice.newBuilder().setOrigin("DEL").setDestination("BOM")
                        .setOriginCity("Delhi").setDestinationCity("Mumbai").setDepartureLocal(day + "T06:45")
                        .setArrivalLocal(day + "T08:55").setDurationMinutes(130).setStops(0)
                        .setSegments(List.of(FlightSegmentInfo.newBuilder().setFlightNumber("AI 504")
                                .setAirlineCode("AI").setAirlineName("Air India").setOrigin("DEL").setDestination("BOM")
                                .setDepartureLocal(day + "T06:45").setArrivalLocal(day + "T08:55")
                                .setDurationMinutes(130).build()))
                        .build()))
                .setAdults(1).setChildren(0).setInfants(0)
                .setSubtotal(EventMoney.of(fare, "INR")).setTaxes(EventMoney.of(taxes, "INR"))
                .setPriceLines(List.of(
                        FlightPriceLine.newBuilder().setLabel("Fare · 1 adult").setAmount(EventMoney.of(fare, "INR")).build(),
                        FlightPriceLine.newBuilder().setLabel("GST 5%").setAmount(EventMoney.of(taxes, "INR")).build()))
                .setTotal(EventMoney.of(fare.add(taxes), "INR"))
                .setHoldExpiresAt(now.plus(20, ChronoUnit.MINUTES)).setHeldAt(now)
                .setDepartureAt(day.atTime(6, 45).atZone(java.time.ZoneId.of("Asia/Kolkata")).toInstant())
                .build());
        paymentSucceeded(bookingId, UUID.randomUUID(), "5175.00");
        flightEvents.handle(eventId(), FlightBookingConfirmed.newBuilder().setBookingId(bookingId.toString())
                .setHoldId(UUID.randomUUID().toString()).setSupplierOrderId("DO1234567890").setPnr("K7M2QX")
                .setTickets(List.of(FlightTicketInfo.newBuilder().setPassengerIndex(1).setTicketNumber("0981234567891")
                        .build()))
                .setConfirmedAt(now).build());
        assertThat((String) JsonPath.read(details(userId, bookingId), "$.status")).isEqualTo("CONFIRMED");
        return bookingId;
    }

    private ResultActions cancel(UUID userId, UUID bookingId, String key, String body) throws Exception {
        return mockMvc.perform(post("/api/bookings/" + bookingId + "/cancel").with(customer(userId))
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions cancelAs(JwtRequestPostProcessor who, UUID bookingId, String body) throws Exception {
        return mockMvc.perform(post("/api/bookings/" + bookingId + "/cancel").with(who)
                .header("Idempotency-Key", "cancel-" + UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private void hotelCancelled(UUID bookingId, String cancellationId, String reference) {
        hotelEvents.handle(eventId(), HotelReservationCancelled.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setCancellationId(cancellationId)
                .setCancellationReference(reference).setCancelledAt(Instant.now()).build());
    }

    private void airlineCancelled(UUID bookingId, String cancellationId, String fee) {
        BigDecimal airlineFee = new BigDecimal(fee);
        flightEvents.handle(eventId(), FlightBookingCancelled.newBuilder().setBookingId(bookingId.toString())
                .setHoldId(UUID.randomUUID().toString()).setCancellationId(cancellationId)
                .setSupplierOrderId("DO1234567890").setCancellationReference("DXK7M3Q9P2")
                .setAirlineFee(EventMoney.of(airlineFee, "INR"))
                .setAirlineRefund(EventMoney.of(new BigDecimal("5175.00").subtract(airlineFee), "INR"))
                .setCancelledAt(Instant.now()).build());
    }

    private void refundCompleted(UUID bookingId, BookingRefundRequested request) {
        paymentEvents.handle(eventId(), RefundCompleted.newBuilder().setRefundId(UUID.randomUUID().toString())
                .setRefundRequestId(request.getRefundRequestId()).setPaymentId(request.getPaymentId())
                .setBookingId(bookingId.toString()).setUserId(request.getUserId()).setAmount(request.getAmount())
                .setCompletedAt(Instant.now()).build());
    }

    /** Moves the last time a request was sent past the reconciliation wait (UTC, like Hibernate stores it). */
    private void age(String table, String idColumn, String id) {
        jdbcClient.sql("UPDATE " + table + " SET last_sent_at = UTC_TIMESTAMP(6) - INTERVAL 2 HOUR WHERE " + idColumn
                + " = UUID_TO_BIN(:id)").param("id", id).update();
    }

    private <T> List<T> eventsOfType(UUID bookingId, Class<T> type) {
        return events(bookingId).stream().filter(type::isInstance).map(type::cast).toList();
    }

    private List<AuditEventRecorded> audit(UUID bookingId) {
        return jdbcClient.sql("""
                        SELECT payload FROM outbox_events WHERE aggregate_type = 'audit' AND aggregate_id = :id
                        ORDER BY created_at, id""")
                .param("id", bookingId.toString())
                .query((rs, i) -> (AuditEventRecorded) AVRO.deserialize("audit.events", rs.getBytes("payload")))
                .list();
    }

    private List<String> auditActions(UUID bookingId) {
        return audit(bookingId).stream().map(AuditEventRecorded::getAction).toList();
    }
}
