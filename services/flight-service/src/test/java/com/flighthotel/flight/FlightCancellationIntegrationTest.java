package com.flighthotel.flight;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.flighthotel.events.audit.AuditEventRecorded;
import com.flighthotel.events.booking.BookingCancellationRequested;
import com.flighthotel.events.flight.FlightBookingCancelled;
import com.flighthotel.events.flight.FlightCancellationFailed;
import com.flighthotel.events.flight.FlightOfferHeld;
import com.jayway.jsonpath.JsonPath;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;

/**
 * Phase 7 exit check, flight side: the airline cancels an issued booking at its own fee and puts the seats back on sale;
 * refusals (too late, not allowed) and unanswered cancellations (looked up, never sent twice) of BOOKING_WORKFLOW.md
 * section 4.
 */
class FlightCancellationIntegrationTest extends FlightIntegrationTest {

    private static final KafkaAvroDeserializer AVRO = new KafkaAvroDeserializer();

    static {
        AVRO.configure(Map.of("schema.registry.url", "mock://flight-it", "specific.avro.reader", true), false);
    }

    @Test
    void anIssuedBookingIsCancelledAtTheFareFamilysFeeAndTheSeatsGoBackOnSale() throws Exception {
        String trip = oneWayTrip(50, 2);
        UUID bookingId = issued(trip, "Rao");
        assertThat(seatsOf(trip, 0)).containsExactly(0, 2);
        // The first departure travels with the hold as an instant (DEL is in India).
        assertThat(single(bookingId, FlightOfferHeld.class).getDepartureAt()).isEqualTo(
                LocalDateTime.parse((String) JsonPath.read(trip, "$.slices[0].departureLocal"))
                        .atZone(ZoneId.of("Asia/Kolkata")).toInstant());

        UUID cancellationId = UUID.randomUUID();
        bookingEvents.handle(eventId(), cancel(bookingId, cancellationId));

        // Fee = fee % of the fare (not of the taxes); the rest of the total comes back.
        BigDecimal fare = new BigDecimal(JsonPath.read(trip, "$.subtotal").toString());
        BigDecimal total = new BigDecimal(JsonPath.read(trip, "$.total").toString());
        int feePercent = JsonPath.read(trip, "$.slices[0].fare.cancellationFeePercent");
        BigDecimal fee = fare.multiply(BigDecimal.valueOf(feePercent)).divide(BigDecimal.valueOf(100), 2,
                RoundingMode.HALF_UP);
        FlightBookingCancelled cancelled = single(bookingId, FlightBookingCancelled.class);
        assertThat(cancelled.getCancellationId()).isEqualTo(cancellationId.toString());
        assertThat(cancelled.getCancellationReference()).matches("DX[A-Z2-9]{8}");
        assertThat(cancelled.getAirlineFee().getAmount()).isEqualByComparingTo(fee);
        assertThat(cancelled.getAirlineRefund().getAmount()).isEqualByComparingTo(total.subtract(fee));
        assertThat(fee).isPositive().isLessThan(total);
        assertThat(bookingStatus(bookingId)).isEqualTo("CANCELLED");
        assertThat(seatsOf(trip, 0)).containsExactly(0, 0);
        assertThat(orderStatus(bookingId)).isEqualTo("CANCELLED");
        AuditEventRecorded audit = audit(bookingId).getFirst();
        assertThat(audit.getAction()).isEqualTo("FLIGHT_ORDER_CANCELLED");
        assertThat(audit.getDetails()).containsEntry("airlineFee", fee.toPlainString())
                .containsEntry("cancellationId", cancellationId.toString());

        // Asked again (booking-service's reconciliation): the same answer, the seats are not given back twice.
        bookingEvents.handle(eventId(), cancel(bookingId, cancellationId));
        assertThat(eventsOf(bookingId, FlightBookingCancelled.class)).hasSize(2)
                .extracting(FlightBookingCancelled::getCancellationReference)
                .containsOnly(cancelled.getCancellationReference());
        assertThat(seatsOf(trip, 0)).containsExactly(0, 0);
        assertThat(audit(bookingId)).hasSize(1);
    }

    @Test
    void theAirlineRefusesWhenItIsTooLateOrNotAllowedAndTheTicketsStayValid() throws Exception {
        String notAllowedTrip = oneWayTrip(51, 1);
        UUID notAllowed = issued(notAllowedTrip, "Nocancel");
        String lateTrip = oneWayTrip(52, 1);
        UUID late = issued(lateTrip, "Rao");
        // The flight leaves in less than 4 hours: move the sold seats to a departure in the past.
        String date = ((String) JsonPath.read(lateTrip, "$.slices[0].departureLocal")).substring(0, 10);
        jdbcClient.sql("UPDATE demo_orders SET seats = REPLACE(seats, :date, :yesterday) WHERE idempotency_key = :key")
                .param("date", date).param("yesterday", LocalDate.now().minusDays(1).toString())
                .param("key", late.toString()).update();

        bookingEvents.handle(eventId(), cancel(notAllowed, UUID.randomUUID()));
        bookingEvents.handle(eventId(), cancel(late, UUID.randomUUID()));
        UUID unknown = UUID.randomUUID();
        bookingEvents.handle(eventId(), cancel(unknown, UUID.randomUUID()));

        FlightCancellationFailed refused = single(notAllowed, FlightCancellationFailed.class);
        assertThat(refused.getReason()).isEqualTo("NOT_ALLOWED");
        assertThat(refused.getMessage()).contains("does not allow");
        assertThat(single(late, FlightCancellationFailed.class).getReason()).isEqualTo("TOO_LATE");
        assertThat(single(unknown, FlightCancellationFailed.class).getReason()).isEqualTo("NOT_CANCELLABLE");
        assertThat(bookingStatus(notAllowed)).isEqualTo("CONFIRMED");
        assertThat(bookingStatus(late)).isEqualTo("CONFIRMED");
        assertThat(orderStatus(notAllowed)).isEqualTo("ISSUED");
        assertThat(seatsOf(notAllowedTrip, 0)).containsExactly(0, 1);
        assertThat(eventsOf(notAllowed, FlightBookingCancelled.class)).isEmpty();
        assertThat(audit(notAllowed)).isEmpty();
    }

    @Test
    void anUnansweredCancellationIsLookedUpNeverSentTwice() throws Exception {
        String trip = oneWayTrip(53, 1);
        UUID bookingId = issued(trip, "Canceltimeout");
        UUID cancellationId = UUID.randomUUID();

        bookingEvents.handle(eventId(), cancel(bookingId, cancellationId));

        // The airline cancelled, but the answer was lost: unknown to us, no event yet.
        assertThat(bookingStatus(bookingId)).isEqualTo("CANCEL_UNCERTAIN");
        assertThat(orderStatus(bookingId)).isEqualTo("CANCELLED");
        assertThat(eventsOf(bookingId, FlightBookingCancelled.class)).isEmpty();
        // Asked again meanwhile: nothing is sent to the airline a second time.
        bookingEvents.handle(eventId(), cancel(bookingId, cancellationId));
        assertThat(eventsOf(bookingId, FlightBookingCancelled.class)).isEmpty();
        jobs.reconcileUncertainBookings();
        assertThat(bookingStatus(bookingId)).isEqualTo("CANCEL_UNCERTAIN");

        makeDue(bookingId);
        jobs.reconcileUncertainBookings();

        FlightBookingCancelled cancelled = single(bookingId, FlightBookingCancelled.class);
        assertThat(cancelled.getCancellationId()).isEqualTo(cancellationId.toString());
        assertThat(bookingStatus(bookingId)).isEqualTo("CANCELLED");
        assertThat(seatsOf(trip, 0)).containsExactly(0, 0);
        jobs.reconcileUncertainBookings();
        assertThat(eventsOf(bookingId, FlightBookingCancelled.class)).hasSize(1);
    }

    @Test
    void aCancellationTheAirlineNeverMadeIsReportedAfterSeveralLooksAndTheBookingStaysValid() throws Exception {
        String trip = oneWayTrip(54, 1);
        UUID bookingId = issued(trip, "Cancellost");
        UUID cancellationId = UUID.randomUUID();

        bookingEvents.handle(eventId(), cancel(bookingId, cancellationId));
        assertThat(bookingStatus(bookingId)).isEqualTo("CANCEL_UNCERTAIN");
        assertThat(orderStatus(bookingId)).isEqualTo("ISSUED");

        makeDue(bookingId);
        jobs.reconcileUncertainBookings();
        // First look: nothing found, but not enough looks and time yet.
        assertThat(bookingStatus(bookingId)).isEqualTo("CANCEL_UNCERTAIN");
        assertThat(eventsOf(bookingId, FlightCancellationFailed.class)).isEmpty();

        jdbcClient.sql("UPDATE flight_supplier_bookings SET uncertain_since = UTC_TIMESTAMP(6) - INTERVAL 10 MINUTE, "
                + "next_reconcile_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).update();
        jobs.reconcileUncertainBookings();

        FlightCancellationFailed failed = single(bookingId, FlightCancellationFailed.class);
        assertThat(failed.getReason()).isEqualTo("SUPPLIER_NO_ANSWER");
        assertThat(failed.getCancellationId()).isEqualTo(cancellationId.toString());
        assertThat(failed.getMessage()).contains("still valid");
        assertThat(bookingStatus(bookingId)).isEqualTo("CONFIRMED");
        assertThat(seatsOf(trip, 0)).containsExactly(0, 1);
    }

    // ------------------------------------------------------------------ helpers

    /** Held, paid and issued by the DEMO airline. */
    private UUID issued(String trip, String lastName) {
        int adults = JsonPath.read(trip, "$.passengers.adults");
        var passengers = new com.flighthotel.events.booking.FlightPassengerInfo[adults];
        for (int i = 0; i < adults; i++) {
            passengers[i] = passenger(i + 1, "ADULT", i == 0 ? "Asha" : "Ravi", i == 0 ? lastName : "Kumar");
        }
        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passengers);
        paid(bookingId);
        assertThat(bookingStatus(bookingId)).isEqualTo("CONFIRMED");
        return bookingId;
    }

    private static BookingCancellationRequested cancel(UUID bookingId, UUID cancellationId) {
        return BookingCancellationRequested.newBuilder().setBookingId(bookingId.toString())
                .setBookingReference("FL-CANCEL01").setBookingType("FLIGHT")
                .setCancellationId(cancellationId.toString()).setInitiatedBy("CUSTOMER")
                .setRequestedAt(Instant.now()).build();
    }

    private String orderStatus(UUID bookingId) {
        return jdbcClient.sql("SELECT status FROM demo_orders WHERE idempotency_key = :key")
                .param("key", bookingId.toString()).query(String.class).single();
    }

    private void makeDue(UUID bookingId) {
        jdbcClient.sql("UPDATE flight_supplier_bookings SET next_reconcile_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND "
                + "WHERE booking_id = UUID_TO_BIN(:id)").param("id", bookingId.toString()).update();
    }

    private List<AuditEventRecorded> audit(UUID bookingId) {
        return jdbcClient.sql("SELECT payload FROM outbox_events WHERE aggregate_type = 'audit' AND aggregate_id = :id "
                        + "ORDER BY created_at, id")
                .param("id", bookingId.toString())
                .query((rs, i) -> (AuditEventRecorded) AVRO.deserialize("audit.events", rs.getBytes("payload")))
                .list();
    }
}
