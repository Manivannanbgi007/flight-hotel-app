package com.flighthotel.flight;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.flight.FlightBookingConfirmed;
import com.flighthotel.events.flight.FlightBookingFailed;
import com.flighthotel.events.flight.FlightBookingUncertain;
import com.flighthotel.events.flight.FlightOfferHeld;
import com.flighthotel.events.flight.FlightOfferHoldFailed;
import com.flighthotel.events.flight.FlightOfferReleased;
import com.jayway.jsonpath.JsonPath;

/** flight-service's part of the flight booking saga: every failure path of BOOKING_WORKFLOW.md section 3. */
class FlightBookingSagaIntegrationTest extends FlightIntegrationTest {

    private UUID heldBooking(int daysAhead, String lastName) throws Exception {
        String trip = oneWayTrip(daysAhead, 1);
        return initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", lastName));
    }

    private long orders(UUID bookingId) {
        return jdbcClient.sql("SELECT COUNT(*) FROM demo_orders WHERE idempotency_key = :key")
                .param("key", bookingId.toString()).query(Long.class).single();
    }

    // ------------------------------------------------------------------ hold

    @Test
    void theSeatsAreHeldAtTheAcceptedPriceUntilTheDeadline() throws Exception {
        String trip = oneWayTrip(31, 2);
        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"),
                passenger(2, "ADULT", "Ravi", "Kumar"));

        FlightOfferHeld held = single(bookingId, FlightOfferHeld.class);
        assertThat(EventMoney.amount(held.getTotal())).isEqualByComparingTo(
                new BigDecimal(String.valueOf((Object) JsonPath.read(trip, "$.total"))));
        assertThat(held.getTitle()).isEqualTo("Delhi to Mumbai");
        assertThat(held.getAdults()).isEqualTo(2);
        assertThat(held.getSlices()).hasSize(1);
        assertThat(held.getSlices().getFirst().getSegments()).isNotEmpty();
        assertThat(held.getPriceLines()).extracting(line -> line.getLabel()).contains("Fare · 2 adults");
        assertThat(held.getDemo()).isTrue();
        assertThat(held.getHoldExpiresAt()).isAfter(held.getHeldAt());
        assertThat(seatsOf(trip, 0)).containsExactly(2, 0);
        assertThat(bookingStatus(bookingId)).isEqualTo("HELD");

        // The same BookingInitiated again (a re-delivery with a new event id) changes nothing.
        bookingEvents.handle(eventId(), com.flighthotel.events.booking.BookingInitiated.newBuilder()
                .setBookingId(bookingId.toString()).setBookingReference("FL-AGAIN000").setUserId(UUID.randomUUID().toString())
                .setBookingType("FLIGHT").setFlight(com.flighthotel.events.booking.FlightBookingRequest.newBuilder()
                        .setOfferId(JsonPath.read(trip, "$.tripOfferId")).setPassengers(java.util.List.of(
                                passenger(1, "ADULT", "Asha", "Rao"), passenger(2, "ADULT", "Ravi", "Kumar")))
                        .setContactEmail("a@b.c").setContactPhone("1234567").build())
                .setInitiatedAt(java.time.Instant.now()).build());
        assertThat(eventsOf(bookingId, FlightOfferHeld.class)).hasSize(1);
        assertThat(seatsOf(trip, 0)).containsExactly(2, 0);
    }

    @Test
    void anExpiredTripHoldsNothing() {
        UUID bookingId = initiate(UUID.randomUUID().toString(), passenger(1, "ADULT", "Asha", "Rao"));

        FlightOfferHoldFailed failed = single(bookingId, FlightOfferHoldFailed.class);
        assertThat(failed.getReason()).isEqualTo("OFFER_EXPIRED");
        assertThat(failed.getMessage()).contains("search again");
    }

    @Test
    void travellersThatDoNotMatchTheTripAreRefused() throws Exception {
        String trip = oneWayTrip(32, 2);
        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"));

        assertThat(single(bookingId, FlightOfferHoldFailed.class).getReason()).isEqualTo("INVALID_PASSENGERS");
        assertThat(seatsOf(trip, 0)).containsExactly(0, 0);
    }

    @Test
    void seatsThatSoldOutBetweenSelectionAndBookingFailTheHold() throws Exception {
        String trip = oneWayTrip(33, 1);
        jdbcClient.sql("UPDATE demo_seat_inventory SET seats_sold = seats_total WHERE cabin = 'ECONOMY' AND flight_date = :d")
                .param("d", java.sql.Date.valueOf(date(33))).update();
        // The flight had no inventory rows yet: create them full.
        seatInventoryFull(trip, 0);

        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"));

        assertThat(single(bookingId, FlightOfferHoldFailed.class).getReason()).isEqualTo("SOLD_OUT");
    }

    @Test
    void aFareThatChangedSinceTheCustomerAcceptedItIsNotHonoured() throws Exception {
        String trip = oneWayTrip(34, 1);
        BigDecimal accepted = new BigDecimal(String.valueOf((Object) JsonPath.read(trip, "$.total")));
        // The flight is 60 % full by now.
        seatInventory(trip, 0, 90);

        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"));

        FlightOfferHoldFailed failed = single(bookingId, FlightOfferHoldFailed.class);
        assertThat(failed.getReason()).isEqualTo("PRICE_CHANGED");
        assertThat(EventMoney.amount(failed.getNewTotal())).isGreaterThan(accepted);
        assertThat(seatsOf(trip, 0)[0]).isZero();
    }

    // ------------------------------------------------------------------ paid: the airline issues the booking

    @Test
    void aPaidBookingGetsItsPnrAndOneTicketPerPassenger() throws Exception {
        String trip = oneWayTrip(35, 2);
        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"),
                passenger(2, "ADULT", "Ravi", "Kumar"));

        paid(bookingId);

        FlightBookingConfirmed confirmed = single(bookingId, FlightBookingConfirmed.class);
        assertThat(confirmed.getPnr()).hasSize(6);
        assertThat(confirmed.getTickets()).hasSize(2);
        assertThat(confirmed.getTickets()).extracting(t -> t.getPassengerIndex()).containsExactly(1, 2);
        assertThat(confirmed.getTickets()).allMatch(t -> t.getTicketNumber().startsWith("098"));
        assertThat(bookingStatus(bookingId)).isEqualTo("CONFIRMED");
        assertThat(seatsOf(trip, 0)).containsExactly(0, 2);
        assertThat(orders(bookingId)).isEqualTo(1);

        // BookingPaid delivered again: no second order, no second event.
        paid(bookingId);
        assertThat(eventsOf(bookingId, FlightBookingConfirmed.class)).hasSize(1);
        assertThat(orders(bookingId)).isEqualTo(1);
        assertThat(seatsOf(trip, 0)).containsExactly(0, 2);
    }

    @Test
    void anAirlineThatRejectsTheOrderGetsTheSeatsBackAndTheCustomerIsRefunded() throws Exception {
        String trip = oneWayTrip(36, 1);
        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Reject"));
        assertThat(seatsOf(trip, 0)).containsExactly(1, 0);

        paid(bookingId);

        FlightBookingFailed failed = single(bookingId, FlightBookingFailed.class);
        assertThat(failed.getReason()).isEqualTo("SUPPLIER_REJECTED");
        assertThat(failed.getMessage()).contains("refunded");
        assertThat(bookingStatus(bookingId)).isEqualTo("FAILED");
        assertThat(seatsOf(trip, 0)).containsExactly(0, 0);
        assertThat(orders(bookingId)).isZero();
    }

    // ------------------------------------------------------------------ uncertain outcomes

    @Test
    void whenTheAirlineDoesNotAnswerTheOrderIsLookedUpNeverCreatedTwice() throws Exception {
        String trip = oneWayTrip(37, 1);
        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Timeout"));

        paid(bookingId);

        // The order exists at the airline, but the answer was lost: unknown to us, never retried blindly.
        assertThat(single(bookingId, FlightBookingUncertain.class).getReason()).isEqualTo("SUPPLIER_TIMEOUT");
        assertThat(bookingStatus(bookingId)).isEqualTo("UNCERTAIN");
        assertThat(eventsOf(bookingId, FlightBookingConfirmed.class)).isEmpty();
        assertThat(orders(bookingId)).isEqualTo(1);
        // Too early: the job waits for the first look-up time.
        jobs.reconcileUncertainBookings();
        assertThat(bookingStatus(bookingId)).isEqualTo("UNCERTAIN");

        makeDue(bookingId);
        jobs.reconcileUncertainBookings();

        FlightBookingConfirmed confirmed = single(bookingId, FlightBookingConfirmed.class);
        assertThat(confirmed.getPnr()).hasSize(6);
        assertThat(bookingStatus(bookingId)).isEqualTo("CONFIRMED");
        assertThat(orders(bookingId)).isEqualTo(1);
        assertThat(seatsOf(trip, 0)).containsExactly(0, 1);
        // Further runs change nothing.
        jobs.reconcileUncertainBookings();
        assertThat(eventsOf(bookingId, FlightBookingConfirmed.class)).hasSize(1);
    }

    @Test
    void anOrderTheAirlineNeverCreatedIsFoundMissingAndRefundedAfterSeveralLooks() throws Exception {
        String trip = oneWayTrip(38, 1);
        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "TimeoutLost"));

        paid(bookingId);
        assertThat(single(bookingId, FlightBookingUncertain.class)).isNotNull();
        assertThat(orders(bookingId)).isZero();

        makeDue(bookingId);
        jobs.reconcileUncertainBookings();
        // First look: not found, but not enough looks and time yet.
        assertThat(bookingStatus(bookingId)).isEqualTo("UNCERTAIN");
        assertThat(eventsOf(bookingId, FlightBookingFailed.class)).isEmpty();
        assertThat(seatsOf(trip, 0)).containsExactly(1, 0);

        // Second look after the "not found" waiting time: the airline has no order, the customer is refunded.
        jdbcClient.sql("UPDATE flight_supplier_bookings SET uncertain_since = UTC_TIMESTAMP(6) - INTERVAL 10 MINUTE, "
                + "next_reconcile_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).update();
        jobs.reconcileUncertainBookings();

        FlightBookingFailed failed = single(bookingId, FlightBookingFailed.class);
        assertThat(failed.getReason()).isEqualTo("NOT_FOUND_AT_SUPPLIER");
        assertThat(bookingStatus(bookingId)).isEqualTo("FAILED");
        assertThat(seatsOf(trip, 0)).containsExactly(0, 0);
    }

    @Test
    void anOutcomeThatStaysUnknownForTooLongNeedsAPerson() throws Exception {
        String trip = oneWayTrip(39, 1);
        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "TimeoutLost"));
        paid(bookingId);

        jdbcClient.sql("UPDATE flight_supplier_bookings SET uncertain_since = UTC_TIMESTAMP(6) - INTERVAL 3 HOUR, "
                + "attempts = 0, next_reconcile_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).update();
        // maxAttempts is 2 in tests and only 1 look is made now, so the booking is not refunded blindly: it escalates.
        jobs.reconcileUncertainBookings();

        assertThat(bookingStatus(bookingId)).isEqualTo("NEEDS_ATTENTION");
        assertThat(eventsOf(bookingId, FlightBookingFailed.class)).isEmpty();
    }

    // ------------------------------------------------------------------ holds that end

    @Test
    void seatsOfABookingThatFailedOrExpiredInBookingServiceAreGivenBack() throws Exception {
        String failedTrip = oneWayTrip(41, 1);
        UUID failed = initiate(JsonPath.read(failedTrip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"));
        String expiredTrip = oneWayTrip(42, 1);
        UUID expired = initiate(JsonPath.read(expiredTrip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"));

        bookingFailed(failed);
        bookingExpired(expired);

        assertThat(seatsOf(failedTrip, 0)).containsExactly(0, 0);
        assertThat(seatsOf(expiredTrip, 0)).containsExactly(0, 0);
        assertThat(bookingStatus(failed)).isEqualTo("RELEASED");
        assertThat(single(failed, FlightOfferReleased.class).getReason()).isEqualTo("BOOKING_FAILED");
        assertThat(single(expired, FlightOfferReleased.class).getReason()).isEqualTo("BOOKING_EXPIRED");
    }

    @Test
    void anUnpaidHoldExpiresAndTheJobLeavesHoldsThatAreStillValid() throws Exception {
        String lateTrip = oneWayTrip(43, 1);
        UUID late = initiate(JsonPath.read(lateTrip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"));
        String freshTrip = oneWayTrip(44, 1);
        UUID fresh = initiate(JsonPath.read(freshTrip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"));
        jdbcClient.sql("UPDATE flight_supplier_bookings SET hold_expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE "
                + "WHERE booking_id = UUID_TO_BIN(:id)").param("id", late.toString()).update();

        jobs.releaseExpiredHolds();

        assertThat(bookingStatus(late)).isEqualTo("EXPIRED");
        assertThat(single(late, FlightOfferReleased.class).getReason()).isEqualTo("EXPIRED");
        assertThat(seatsOf(lateTrip, 0)).containsExactly(0, 0);
        assertThat(bookingStatus(fresh)).isEqualTo("HELD");
        assertThat(seatsOf(freshTrip, 0)).containsExactly(1, 0);
    }

    @Test
    void aPaymentThatArrivesAfterTheHoldExpiredStillGetsTheSeatsIfTheyAreFree() throws Exception {
        String trip = oneWayTrip(45, 1);
        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"));
        expireNow(bookingId);
        jobs.releaseExpiredHolds();
        assertThat(bookingStatus(bookingId)).isEqualTo("EXPIRED");

        paid(bookingId);

        assertThat(single(bookingId, FlightBookingConfirmed.class).getPnr()).hasSize(6);
        assertThat(bookingStatus(bookingId)).isEqualTo("CONFIRMED");
        assertThat(seatsOf(trip, 0)).containsExactly(0, 1);
    }

    @Test
    void aLatePaymentForSeatsSoldMeanwhileFailsSoTheCustomerIsRefunded() throws Exception {
        String trip = oneWayTrip(46, 1);
        UUID bookingId = initiate(JsonPath.read(trip, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"));
        expireNow(bookingId);
        jobs.releaseExpiredHolds();
        seatInventoryFull(trip, 0);   // the flight sold out meanwhile

        paid(bookingId);

        FlightBookingFailed failed = single(bookingId, FlightBookingFailed.class);
        assertThat(failed.getReason()).isEqualTo("HOLD_LOST");
        assertThat(bookingStatus(bookingId)).isEqualTo("FAILED");
    }

    @Test
    void twoCustomersCannotHoldTheSameLastSeats() throws Exception {
        String first = oneWayTrip(47, 1);
        String second = oneWayTrip(47, 1);
        // Only one seat is left on the flight.
        seatInventory(first, 0, 149);

        UUID a = initiate(JsonPath.read(first, "$.tripOfferId"), passenger(1, "ADULT", "Asha", "Rao"));
        UUID b = initiate(JsonPath.read(second, "$.tripOfferId"), passenger(1, "ADULT", "Ravi", "Kumar"));

        long held = eventsOf(a, FlightOfferHeld.class).size() + eventsOf(b, FlightOfferHeld.class).size();
        // The price rose at 149/150 sold: both are refused as PRICE_CHANGED or exactly one holds the last seat.
        assertThat(held).isLessThanOrEqualTo(1);
        assertThat(seatsOf(first, 0)[0] + seatsOf(first, 0)[1]).isLessThanOrEqualTo(150);
    }

    // ------------------------------------------------------------------ helpers

    private void makeDue(UUID bookingId) {
        jdbcClient.sql("UPDATE flight_supplier_bookings SET next_reconcile_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND "
                + "WHERE booking_id = UUID_TO_BIN(:id)").param("id", bookingId.toString()).update();
    }

    private void expireNow(UUID bookingId) {
        jdbcClient.sql("UPDATE flight_supplier_bookings SET hold_expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE "
                + "WHERE booking_id = UUID_TO_BIN(:id)").param("id", bookingId.toString()).update();
    }

    private String scheduleId(String trip) {
        String flightNumber = JsonPath.read(trip, "$.slices[0].flightNumber");
        return jdbcClient.sql("SELECT BIN_TO_UUID(id) FROM demo_flight_schedules WHERE flight_number = :f "
                        + "AND origin = 'DEL' AND destination = 'BOM'").param("f", flightNumber).query(String.class)
                .single();
    }

    /** Sets how many economy seats of the trip's flight are already sold. */
    private void seatInventory(String trip, int slice, int sold) {
        String when = JsonPath.read(trip, "$.slices[" + slice + "].departureLocal");
        jdbcClient.sql("INSERT INTO demo_seat_inventory (id, schedule_id, flight_date, cabin, seats_total, seats_sold) "
                        + "VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(:s), :d, 'ECONOMY', 150, :sold) "
                        + "ON DUPLICATE KEY UPDATE seats_sold = :sold")
                .param("s", scheduleId(trip)).param("d", java.sql.Date.valueOf(when.substring(0, 10)))
                .param("sold", sold).update();
    }

    private void seatInventoryFull(String trip, int slice) {
        seatInventory(trip, slice, 150);
    }
}
