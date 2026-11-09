package com.flighthotel.flight.booking;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.events.booking.BookingInitiated;
import com.flighthotel.events.booking.FlightBookingRequest;
import com.flighthotel.events.booking.FlightPassengerInfo;
import com.flighthotel.flight.config.FlightProperties;
import com.flighthotel.flight.dto.FlightDtos.StoredTrip;
import com.flighthotel.flight.dto.FlightDtos.TripOffer;
import com.flighthotel.flight.entity.SupplierBooking;
import com.flighthotel.flight.integration.FlightModel.OptionRef;
import com.flighthotel.flight.integration.FlightModel.OrderPassenger;
import com.flighthotel.flight.integration.FlightModel.OrderPricing;
import com.flighthotel.flight.integration.FlightModel.OrderRequest;
import com.flighthotel.flight.integration.FlightModel.Passengers;
import com.flighthotel.flight.integration.FlightModel.Quote;
import com.flighthotel.flight.integration.FlightModel.SeatRequest;
import com.flighthotel.flight.integration.FlightModel.SoldOutException;
import com.flighthotel.flight.integration.FlightModel.SupplierException;
import com.flighthotel.flight.integration.FlightModel.SupplierOrder;
import com.flighthotel.flight.integration.FlightModel.SupplierRejectedException;
import com.flighthotel.flight.integration.FlightModel.SupplierTimeoutException;
import com.flighthotel.flight.integration.FlightProviders.FlightBookingProvider;
import com.flighthotel.flight.repository.SupplierBookingRepository;
import com.flighthotel.flight.service.OfferStore;
import com.flighthotel.flight.service.ProviderRegistry;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * flight-service's part of the flight booking saga (BOOKING_WORKFLOW.md section 3): hold the seats of an accepted trip,
 * order the tickets when the booking is paid (never blindly retried: an unknown outcome is reconciled), and give the
 * seats back when the booking fails or the hold runs out. Every method runs in the caller's transaction and writes its
 * answer to the outbox in that same transaction.
 */
@Service
public class HoldService {

    private static final Logger log = LoggerFactory.getLogger(HoldService.class);
    private static final Duration[] BACKOFF = { Duration.ofMinutes(1), Duration.ofMinutes(2), Duration.ofMinutes(5),
            Duration.ofMinutes(10) };

    private final OfferStore store;
    private final ProviderRegistry providers;
    private final SupplierBookingRepository bookings;
    private final FlightEvents events;
    private final JdbcClient jdbc;
    private final JsonMapper json;
    private final FlightProperties properties;
    private final Clock clock;

    public HoldService(OfferStore store, ProviderRegistry providers, SupplierBookingRepository bookings,
            FlightEvents events, JdbcClient jdbc, JsonMapper json, FlightProperties properties, Clock clock) {
        this.store = store;
        this.providers = providers;
        this.bookings = bookings;
        this.events = events;
        this.jdbc = jdbc;
        this.json = json;
        this.properties = properties;
        this.clock = clock;
    }

    // ================================================================== BookingInitiated

    /** Hold the seats of the accepted trip at today's price, or explain why not. Nothing is reserved on failure. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void hold(BookingInitiated initiated) {
        UUID bookingId = UUID.fromString(initiated.getBookingId());
        FlightBookingRequest request = initiated.getFlight();
        Instant now = clock.instant();
        if (bookings.existsByBookingId(bookingId)) {
            log.info("Booking already has a flight hold, ignoring repeated request bookingId={}", bookingId);
            return;
        }
        StoredTrip stored = store.findTrip(request.getOfferId()).orElse(null);
        if (stored == null) {
            events.holdFailed(bookingId, "OFFER_EXPIRED",
                    "The prices you selected have expired. Please search again.", null, null, now);
            return;
        }
        TripOffer trip = stored.offer();
        Passengers expected = trip.passengers();
        if (!passengersMatch(request.getPassengers(), expected)) {
            events.holdFailed(bookingId, "INVALID_PASSENGERS",
                    "The travellers do not match the trip you selected.", null, trip.title(), now);
            return;
        }

        FlightBookingProvider provider = providers.bookingProvider(trip.provider());
        // The price is recalculated: a trip is only honoured at the total the customer accepted.
        BigDecimal currentTotal = BigDecimal.ZERO;
        for (OptionRef ref : stored.refs()) {
            try {
                Quote quote = providers.searchProvider(trip.provider()).quote(ref, expected);
                currentTotal = currentTotal.add(quote.price().total());
            } catch (SoldOutException ex) {
                events.holdFailed(bookingId, "SOLD_OUT", "The seats on this flight are sold out. Please choose "
                        + "another flight.", null, trip.title(), now);
                return;
            }
        }
        if (currentTotal.compareTo(trip.total()) != 0) {
            log.info("Fare changed since the trip was priced bookingId={} accepted={} now={}", bookingId,
                    trip.total(), currentTotal);
            events.holdFailed(bookingId, "PRICE_CHANGED", "The fare changed since you selected this trip.",
                    currentTotal, trip.title(), now);
            return;
        }

        List<SeatRequest> seats = seats(stored.refs(), expected);
        if (!provider.hold(seats)) {
            events.holdFailed(bookingId, "SOLD_OUT", "The seats on this flight are sold out. Please choose another "
                    + "flight.", null, trip.title(), now);
            return;
        }

        List<OrderPassenger> passengers = request.getPassengers().stream()
                .map(p -> new OrderPassenger(p.getIndex(), p.getPassengerType(), p.getFirstName().strip(),
                        p.getLastName().strip()))
                .toList();
        SupplierBooking booking = bookings.saveAndFlush(SupplierBooking.held(new SupplierBooking.Held(bookingId,
                initiated.getBookingReference(), UUID.fromString(initiated.getUserId()), trip.provider(),
                trip.tripOfferId(), trip.title(), json.writeValueAsString(trip), json.writeValueAsString(passengers),
                expected.adults(), expected.children(), expected.infants(), trip.currency(), trip.total()),
                now.plus(properties.holdDuration())));
        for (SeatRequest seat : seats) {
            jdbc.sql("INSERT INTO flight_hold_items (id, booking_id, schedule_id, flight_date, cabin, seats) VALUES "
                            + "(UUID_TO_BIN(:id), UUID_TO_BIN(:booking), UUID_TO_BIN(:schedule), :date, :cabin, :seats)")
                    .param("id", UuidV7.generate().toString()).param("booking", bookingId.toString())
                    .param("schedule", seat.scheduleId()).param("date", java.sql.Date.valueOf(seat.date()))
                    .param("cabin", seat.cabin()).param("seats", seat.seats()).update();
        }
        events.held(booking, trip, now);
        log.info("Seats held bookingId={} trip={} seats={} until={}", bookingId, trip.title(), expected.seats(),
                booking.getHoldExpiresAt());
    }

    // ================================================================== BookingPaid

    /**
     * The booking is paid: order the tickets. A rejection fails the booking (refund); a timeout leaves the outcome
     * unknown, so the order is looked up later instead of being created again.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void confirm(UUID bookingId) {
        Instant now = clock.instant();
        SupplierBooking booking = bookings.lockByBookingId(bookingId).orElseThrow(() ->
                new IllegalStateException("BookingPaid for a booking without a flight hold: " + bookingId));
        FlightBookingProvider provider = providers.bookingProvider(booking.getProviderCode());
        switch (booking.getStatus()) {
            case SupplierBooking.HELD -> order(booking, provider, now);
            case SupplierBooking.EXPIRED, SupplierBooking.RELEASED -> {
                // Paid after the hold ran out: take the same seats again if they are still free.
                if (provider.hold(seatsOf(bookingId))) {
                    booking.reheld(now.plus(properties.holdDuration()));
                    order(booking, provider, now);
                } else {
                    booking.failed("HOLD_LOST");
                    events.failed(booking, "HOLD_LOST", "The seats were released before the payment arrived and "
                            + "are no longer available.", now);
                    log.warn("Late payment: seats gone, booking will be refunded bookingId={}", bookingId);
                }
            }
            default -> log.info("Ignoring BookingPaid for flight booking {} in status {}", bookingId,
                    booking.getStatus());
        }
    }

    private void order(SupplierBooking booking, FlightBookingProvider provider, Instant now) {
        List<OrderPassenger> passengers = json.readValue(booking.getPassengersJson(),
                new TypeReference<List<OrderPassenger>>() { });
        List<SeatRequest> seats = seatsOf(booking.getBookingId());
        try {
            SupplierOrder order = provider.createOrder(new OrderRequest(booking.getIdempotencyKey(), passengers, seats,
                    pricing(booking)));
            issued(booking, order, now);
        } catch (SupplierRejectedException ex) {
            provider.release(seats);
            booking.failed(ex.getCode());
            events.failed(booking, ex.getCode(), "The airline could not issue your booking. Your payment is being "
                    + "refunded in full.", now);
            log.warn("Supplier rejected the order bookingId={}", booking.getBookingId());
        } catch (SupplierTimeoutException ex) {
            booking.uncertain(now, now.plus(BACKOFF[0]));
            events.uncertain(booking, now);
            log.warn("Supplier did not answer, outcome unknown bookingId={}", booking.getBookingId());
        } catch (SupplierException ex) {
            booking.uncertain(now, now.plus(BACKOFF[0]));
            events.uncertain(booking, now);
            log.warn("Supplier error, outcome unknown bookingId={} code={}", booking.getBookingId(), ex.getCode());
        }
    }

    private void issued(SupplierBooking booking, SupplierOrder order, Instant now) {
        booking.confirmed(order.supplierOrderId(), order.pnr());
        order.tickets().forEach(ticket -> jdbc.sql("INSERT INTO flight_supplier_tickets (id, booking_id, passenger_no, "
                        + "ticket_number) VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(:booking), :no, :ticket)")
                .param("id", UuidV7.generate().toString()).param("booking", booking.getBookingId().toString())
                .param("no", ticket.passengerNo()).param("ticket", ticket.ticketNumber()).update());
        events.confirmed(booking, order, now);
        log.info("Flight booking issued bookingId={} pnr={}", booking.getBookingId(), order.pnr());
    }

    // ================================================================== give the seats back

    /** booking-service gave up on the booking (failed or expired there): free the seats if they are still held. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void release(UUID bookingId, String reason) {
        bookings.lockByBookingId(bookingId).filter(SupplierBooking::isHeld).ifPresent(booking -> {
            providers.bookingProvider(booking.getProviderCode()).release(seatsOf(bookingId));
            booking.released(SupplierBooking.RELEASED);
            events.released(booking, reason, clock.instant());
            log.info("Flight hold released bookingId={} reason={}", bookingId, reason);
        });
    }

    /** The customer did not pay in time. @return true when the hold was released */
    @Transactional
    public boolean expire(UUID bookingId) {
        Instant now = clock.instant();
        SupplierBooking booking = bookings.lockByBookingId(bookingId).orElse(null);
        if (booking == null || !booking.isHeld() || !booking.getHoldExpiresAt().isBefore(now)) {
            return false;
        }
        providers.bookingProvider(booking.getProviderCode()).release(seatsOf(bookingId));
        booking.released(SupplierBooking.EXPIRED);
        events.released(booking, "EXPIRED", now);
        log.info("Flight hold expired bookingId={}", bookingId);
        return true;
    }

    // ================================================================== reconciliation of unknown outcomes

    /** Looks the order up at the supplier (BOOKING_WORKFLOW.md section 3). @return true when the booking was settled */
    @Transactional
    public boolean reconcile(UUID bookingId) {
        Instant now = clock.instant();
        SupplierBooking booking = bookings.lockByBookingId(bookingId).orElse(null);
        if (booking == null || !SupplierBooking.UNCERTAIN.equals(booking.getStatus())
                || booking.getNextReconcileAt() == null || booking.getNextReconcileAt().isAfter(now)) {
            return false;
        }
        FlightBookingProvider provider = providers.bookingProvider(booking.getProviderCode());
        FlightProperties.Reconcile rules = properties.reconcile();
        try {
            var found = provider.findOrder(booking.getIdempotencyKey());
            if (found.isPresent()) {
                issued(booking, found.get(), now);
                return true;
            }
            booking.looked(now.plus(backoff(booking.getAttempts() + 1)), "NOT_FOUND");
            boolean lookedEnough = booking.getAttempts() >= rules.maxAttempts()
                    && !now.isBefore(booking.getUncertainSince().plus(rules.notFoundAfter()));
            if (lookedEnough) {
                provider.release(seatsOf(bookingId));
                booking.failed("NOT_FOUND_AT_SUPPLIER");
                events.failed(booking, "NOT_FOUND_AT_SUPPLIER", "The airline has no booking for this payment. Your "
                        + "payment is being refunded in full.", now);
                log.warn("Supplier has no order after {} looks, refunding bookingId={}", booking.getAttempts(),
                        bookingId);
                return true;
            }
        } catch (SupplierException ex) {
            // The supplier cannot be asked right now: try again later, never guess.
            booking.looked(now.plus(backoff(booking.getAttempts() + 1)), ex.getCode());
            log.warn("Supplier look-up failed bookingId={} code={}", bookingId, ex.getCode());
        }
        if (now.isAfter(booking.getUncertainSince().plus(rules.escalateAfter()))) {
            booking.needsAttention();
            log.error("NEEDS ATTENTION: flight booking outcome still unknown bookingId={} since={}", bookingId,
                    booking.getUncertainSince());
        }
        return false;
    }

    /** What the airline sells the order for: the trip exactly as held (fare = base fares, the highest fee %). */
    private OrderPricing pricing(SupplierBooking booking) {
        TripOffer trip = json.readValue(booking.getTripJson(), TripOffer.class);
        int feePercent = trip.slices().stream().mapToInt(slice -> slice.fare().cancellationFeePercent()).max()
                .orElse(100);
        return new OrderPricing(trip.subtotal(), trip.total(), trip.currency(), feePercent);
    }

    static Duration backoff(int attempt) {
        return BACKOFF[Math.min(Math.max(attempt, 1), BACKOFF.length) - 1];
    }

    // ================================================================== helpers

    private static boolean passengersMatch(List<FlightPassengerInfo> given, Passengers expected) {
        long adults = given.stream().filter(p -> "ADULT".equals(p.getPassengerType())).count();
        long children = given.stream().filter(p -> "CHILD".equals(p.getPassengerType())).count();
        long infants = given.stream().filter(p -> "INFANT".equals(p.getPassengerType())).count();
        return adults == expected.adults() && children == expected.children() && infants == expected.infants()
                && given.stream().allMatch(p -> !p.getFirstName().isBlank() && !p.getLastName().isBlank());
    }

    private static List<SeatRequest> seats(List<OptionRef> refs, Passengers passengers) {
        List<SeatRequest> seats = new ArrayList<>();
        for (OptionRef ref : refs) {
            seats.add(new SeatRequest(ref.scheduleId(), ref.date(), ref.cabin(), passengers.seats()));
        }
        return seats;
    }

    private List<SeatRequest> seatsOf(UUID bookingId) {
        return jdbc.sql("SELECT BIN_TO_UUID(schedule_id), flight_date, cabin, seats FROM flight_hold_items "
                        + "WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString())
                .query((rs, i) -> new SeatRequest(rs.getString(1), rs.getDate(2).toLocalDate(), rs.getString(3),
                        rs.getInt(4)))
                .list();
    }
}
