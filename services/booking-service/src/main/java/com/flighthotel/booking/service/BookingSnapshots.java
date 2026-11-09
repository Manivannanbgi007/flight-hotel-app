package com.flighthotel.booking.service;

import java.time.Clock;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.flighthotel.booking.dto.BookingDtos.SliceView;
import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.FlightBooking;
import com.flighthotel.booking.entity.HotelBooking;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.repository.FlightBookingRepository;
import com.flighthotel.booking.repository.HotelBookingRepository;
import com.flighthotel.common.events.EventMoney;
import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.events.booking.BookingSnapshot;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * Publishes the whole booking as it is now ({@code BookingSnapshot} on {@code booking.events}) for read models such as
 * reporting-service: event-carried state transfer, so they never have to ask booking-service.
 * <p>
 * {@link #changed} is called on every change (through {@link BookingLifecycle}); the snapshot itself is written to the
 * outbox just before the transaction commits, once per booking and transaction, so it carries the final state of that
 * transaction (a payment moves a booking through two statuses and changes its payment status in one go).
 */
@Component
public class BookingSnapshots {

    private static final Logger log = LoggerFactory.getLogger(BookingSnapshots.class);

    private final OutboxEventPublisher outbox;
    private final BookingRepository bookings;
    private final HotelBookingRepository hotelBookings;
    private final FlightBookingRepository flightBookings;
    private final JsonMapper json;
    private final Clock clock;

    public BookingSnapshots(OutboxEventPublisher outbox, BookingRepository bookings,
            HotelBookingRepository hotelBookings, FlightBookingRepository flightBookings, JsonMapper json, Clock clock) {
        this.outbox = outbox;
        this.bookings = bookings;
        this.hotelBookings = hotelBookings;
        this.flightBookings = flightBookings;
        this.json = json;
        this.clock = clock;
    }

    /** The booking changed in the current transaction: its snapshot goes out with the commit. */
    public void changed(UUID bookingId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            log.warn("Booking {} changed outside a transaction: no snapshot published", bookingId);
            return;
        }
        // Looked up among the current transaction's synchronizations (not a bound resource), so a nested
        // REQUIRES_NEW transaction gets its own list and the outer one is untouched.
        PendingSnapshots pending = TransactionSynchronizationManager.getSynchronizations().stream()
                .filter(PendingSnapshots.class::isInstance).map(PendingSnapshots.class::cast).findFirst()
                .orElseGet(() -> {
                    PendingSnapshots created = new PendingSnapshots();
                    TransactionSynchronizationManager.registerSynchronization(created);
                    return created;
                });
        pending.ids.add(bookingId);
    }

    /** Writes the snapshot now (the backfill; normal changes go through {@link #changed}). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void publish(Booking booking) {
        outbox.publish(BookingEvents.AGGREGATE_TYPE, booking.getId().toString(), snapshot(booking));
    }

    BookingSnapshot snapshot(Booking booking) {
        String currency = booking.getCurrency();
        BookingSnapshot.Builder snapshot = BookingSnapshot.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingReference(booking.getBookingReference())
                .setUserId(booking.getUserId().toString())
                .setBookingType(booking.getBookingType().name())
                .setStatus(booking.getStatus().name())
                .setPaymentStatus(booking.getPaymentStatus().name())
                .setTitle(booking.getTitle())
                .setDestination(booking.getDestination())
                .setStartDate(booking.getStartDate())
                .setEndDate(booking.getEndDate())
                .setTotalAmount(EventMoney.of(booking.getTotalAmount(), currency))
                .setDiscountAmount(EventMoney.of(booking.getDiscountAmount(), currency))
                .setRefundedAmount(EventMoney.of(booking.getRefundedAmount(), currency))
                .setContactEmail(booking.getContactEmail())
                .setCouponCode(booking.getCouponCode())
                .setCreatedAt(booking.getCreatedAt() != null ? booking.getCreatedAt() : clock.instant())
                .setConfirmedAt(booking.getConfirmedAt())
                .setCancelledAt(booking.getCancelledAt())
                .setDemo("DEMO".equals(booking.getInventorySource()))
                .setChangedAt(clock.instant());
        switch (booking.getBookingType()) {
            case HOTEL -> hotelBookings.findById(booking.getId()).ifPresent(hotel -> hotel(snapshot, hotel));
            case FLIGHT -> flightBookings.findById(booking.getId()).ifPresent(flight -> flight(snapshot, flight));
        }
        return snapshot.build();
    }

    private static void hotel(BookingSnapshot.Builder snapshot, HotelBooking hotel) {
        if (hotel.getHotelId() != null) {
            snapshot.setHotelId(hotel.getHotelId().toString());
        }
        if (snapshot.getDestination() == null) {
            snapshot.setDestination(hotel.getHotelCity());
        }
        snapshot.setDemo(snapshot.getDemo() || hotel.isDemo());
    }

    private void flight(BookingSnapshot.Builder snapshot, FlightBooking flight) {
        snapshot.setDemo(snapshot.getDemo() || flight.isDemo());
        if (flight.getSlicesJson() == null) {
            return;   // not held yet: the route is only known once the airline holds the seats
        }
        List<SliceView> slices = json.readValue(flight.getSlicesJson(), new TypeReference<List<SliceView>>() { });
        if (!slices.isEmpty()) {
            SliceView first = slices.getFirst();
            snapshot.setRouteOrigin(first.origin()).setRouteDestination(first.destination())
                    .setOriginCity(first.originCity());
        }
    }

    /** The bookings changed in one transaction; their snapshots are written just before it commits. */
    private final class PendingSnapshots implements TransactionSynchronization {

        private final Set<UUID> ids = new LinkedHashSet<>();

        @Override
        public void beforeCommit(boolean readOnly) {
            for (UUID id : ids) {
                // From the persistence context: the same (managed) booking the transaction changed.
                bookings.findById(id).ifPresent(BookingSnapshots.this::publish);
            }
        }
    }
}
