package com.flighthotel.hotel.reservation;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.events.booking.BookingCancellationRequested;
import com.flighthotel.events.booking.BookingInitiated;
import com.flighthotel.events.booking.HotelBookingRequest;
import com.flighthotel.events.booking.HotelGuest;
import com.flighthotel.hotel.dto.PublicHotelDtos.Quote;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelReservation;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.ReservationGuest;
import com.flighthotel.hotel.entity.ReservationStatus;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.entity.SalesStatus;
import com.flighthotel.hotel.inventory.InventoryService;
import com.flighthotel.hotel.pricing.PricingService;
import com.flighthotel.hotel.pricing.PricingService.CancellationTerms;
import com.flighthotel.hotel.pricing.PricingService.StayPrice;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.HotelReservationRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.repository.SeasonalRateRepository;
import com.flighthotel.hotel.reservation.ReservationEvents.CancelFailure;
import com.flighthotel.hotel.reservation.ReservationEvents.HoldFailure;
import com.flighthotel.hotel.search.QuoteService;

/**
 * hotel-service's part of the hotel booking saga (BOOKING_WORKFLOW.md §2): hold the rooms of an accepted quote,
 * confirm them when the booking is paid, give them back when it fails or the hold runs out.
 * <p>
 * Every method runs inside the caller's transaction (the Kafka listener's, with its inbox marker, or the expiry job's)
 * and writes its answer to the outbox in that same transaction.
 */
@Service
public class ReservationService {

    private static final Logger log = LoggerFactory.getLogger(ReservationService.class);

    private final QuoteService quotes;
    private final HotelRepository hotels;
    private final RoomTypeRepository roomTypes;
    private final RatePlanRepository ratePlans;
    private final SeasonalRateRepository seasonalRates;
    private final PricingService pricing;
    private final InventoryService inventory;
    private final HotelReservationRepository reservations;
    private final ReservationEvents events;
    private final ReservationNumbers numbers;
    private final AuditPublisher audit;
    private final Duration holdDuration;
    private final Clock clock;

    public ReservationService(QuoteService quotes, HotelRepository hotels, RoomTypeRepository roomTypes,
            RatePlanRepository ratePlans, SeasonalRateRepository seasonalRates, PricingService pricing,
            InventoryService inventory, HotelReservationRepository reservations, ReservationEvents events,
            ReservationNumbers numbers, AuditPublisher audit, @Value("${hotel.booking.hold-duration:20m}") Duration holdDuration, Clock clock) {
        this.quotes = quotes;
        this.hotels = hotels;
        this.roomTypes = roomTypes;
        this.ratePlans = ratePlans;
        this.seasonalRates = seasonalRates;
        this.pricing = pricing;
        this.inventory = inventory;
        this.reservations = reservations;
        this.events = events;
        this.numbers = numbers;
        this.audit = audit;
        this.holdDuration = holdDuration;
        this.clock = clock;
    }

    /**
     * {@code BookingInitiated}: hold the rooms of the accepted quote at today's price, or explain why not. The price
     * is recalculated here: a quote is only honoured if the hotel still sells the same stay for the same total.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void hold(BookingInitiated booking) {
        UUID bookingId = UUID.fromString(booking.getBookingId());
        HotelBookingRequest request = booking.getHotel();
        Instant now = clock.instant();
        if (reservations.existsByBookingId(bookingId)) {
            log.info("Booking already has a reservation, ignoring repeated hold bookingId={}", bookingId);
            return;
        }

        Optional<Quote> found = quotes.find(UUID.fromString(request.getQuoteId()));
        if (found.isEmpty()) {
            fail(bookingId, HoldFailure.QUOTE_EXPIRED, null, null, null, now);
            return;
        }
        Quote quote = found.get();
        if (!guestsMatch(request.getGuests(), quote.rooms())) {
            fail(bookingId, HoldFailure.INVALID_GUESTS, quote.hotelName(), null, null, now);
            return;
        }

        Hotel hotel = hotels.findById(quote.hotelId()).filter(Hotel::isActive).orElse(null);
        RoomType room = roomTypes.findById(quote.roomTypeId())
                .filter(r -> r.getStatus() == SalesStatus.ACTIVE && r.getHotelId().equals(quote.hotelId()))
                .orElse(null);
        RatePlan plan = ratePlans.findById(quote.ratePlanId())
                .filter(p -> p.getStatus() == SalesStatus.ACTIVE && p.getRoomTypeId().equals(quote.roomTypeId()))
                .orElse(null);
        if (hotel == null || room == null || plan == null
                || !room.fits(quote.rooms(), quote.adults(), quote.children())) {
            fail(bookingId, HoldFailure.SOLD_OUT, quote.hotelName(), null, null, now);
            return;
        }

        StayPrice price = pricing.price(plan, seasonalRates.findOverlapping(List.of(plan.getId()), quote.checkIn(),
                quote.checkOut()), quote.checkIn(), quote.checkOut(), quote.rooms());
        if (price.total().compareTo(quote.total()) != 0) {
            log.info("Price changed since the quote bookingId={} quoted={} now={}", bookingId, quote.total(),
                    price.total());
            fail(bookingId, HoldFailure.PRICE_CHANGED, hotel.getName(), price.total(), price.currency(), now);
            return;
        }

        if (!inventory.tryHold(room.getId(), quote.checkIn(), quote.checkOut(), quote.rooms())) {
            fail(bookingId, HoldFailure.SOLD_OUT, hotel.getName(), null, null, now);
            return;
        }

        HotelReservation reservation = reservations.save(HotelReservation.hold(
                new HotelReservation.Stay(bookingId, booking.getBookingReference(),
                        UUID.fromString(booking.getUserId()), hotel.getId(), room.getId(), plan.getId(),
                        quote.quoteId(), quote.checkIn(), quote.checkOut()),
                new HotelReservation.Party(quote.rooms(), quote.adults(), quote.children(),
                        request.getGuests().stream()
                                .map(g -> new ReservationGuest(g.getRoomNo(), g.getFirstName().strip(),
                                        g.getLastName().strip()))
                                .toList()),
                new HotelReservation.Price(price.subtotal(), price.taxes(), price.total(), price.currency()),
                new HotelReservation.Contact(request.getContactEmail(), request.getContactPhone(),
                        request.getSpecialRequests()),
                now.plus(holdDuration)));
        CancellationTerms terms = pricing.cancellation(plan, hotel, quote.checkIn());
        events.held(reservation, hotel, room, plan, QuoteService.taxLines(price.nights(), quote.rooms()), terms, now);
        log.info("Rooms held bookingId={} reservationId={} roomType={} {}..{} rooms={} until={}", bookingId,
                reservation.getId(), room.getId(), quote.checkIn(), quote.checkOut(), quote.rooms(),
                reservation.getHoldExpiresAt());
    }

    /**
     * {@code BookingPaid}: the held rooms become booked. If the hold had already run out (payment in the last
     * seconds), the same rooms are taken again when they are still free; otherwise booking-service is told to refund.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void confirm(UUID bookingId) {
        Instant now = clock.instant();
        HotelReservation reservation = reservations.lockByBookingId(bookingId).orElse(null);
        if (reservation == null) {
            // booking-service only sends BookingPaid after HotelInventoryHeld, so this is a bug or lost data.
            throw new IllegalStateException("BookingPaid for a booking without reservation: " + bookingId);
        }
        switch (reservation.getStatus()) {
            case CONFIRMED -> log.info("Reservation already confirmed bookingId={}", bookingId);
            case HELD -> {
                inventory.confirm(reservation.getRoomTypeId(), reservation.getCheckIn(), reservation.getCheckOut(),
                        reservation.getRooms());
                reservation.confirm(numbers.newConfirmationNumber(), now);
                events.confirmed(reservation, now);
                log.info("Reservation confirmed bookingId={} confirmation={}", bookingId,
                        reservation.getConfirmationNumber());
            }
            case EXPIRED, RELEASED -> {
                if (inventory.tryHold(reservation.getRoomTypeId(), reservation.getCheckIn(), reservation.getCheckOut(),
                        reservation.getRooms())) {
                    reservation.reHold(now);
                    inventory.confirm(reservation.getRoomTypeId(), reservation.getCheckIn(),
                            reservation.getCheckOut(), reservation.getRooms());
                    reservation.confirm(numbers.newConfirmationNumber(), now);
                    events.confirmed(reservation, now);
                    log.info("Late payment: rooms taken again and confirmed bookingId={}", bookingId);
                } else {
                    events.confirmationFailed(reservation, "ROOMS_RELEASED", now);
                    log.warn("Late payment: rooms no longer free, booking will be refunded bookingId={}", bookingId);
                }
            }
        }
    }

    /** booking-service gave up on the booking (failed or expired there): free the rooms if they are still held. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void release(UUID bookingId, String reason) {
        reservations.lockByBookingId(bookingId).filter(HotelReservation::isHeld).ifPresent(reservation -> {
            Instant now = clock.instant();
            inventory.release(reservation.getRoomTypeId(), reservation.getCheckIn(), reservation.getCheckOut(),
                    reservation.getRooms());
            reservation.release(reason, now);
            events.released(reservation, reason, now);
            log.info("Hold released bookingId={} reason={}", bookingId, reason);
        });
    }

    /**
     * {@code BookingCancellationRequested}: the customer cancels a confirmed stay. Allowed until the check-in time (hotel
     * local time) at the moment the customer asked; the booked rooms go back on sale. A repeated request for a stay
     * that is already cancelled repeats the answer (booking-service's reconciliation may ask again).
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void cancel(BookingCancellationRequested request) {
        UUID bookingId = UUID.fromString(request.getBookingId());
        Instant now = clock.instant();
        HotelReservation reservation = reservations.lockByBookingId(bookingId).orElse(null);
        if (reservation != null && reservation.isCancelled()) {
            log.info("Reservation already cancelled, repeating the answer bookingId={}", bookingId);
            events.cancelled(reservation);
            return;
        }
        if (reservation == null || reservation.getStatus() != ReservationStatus.CONFIRMED) {
            events.cancellationFailed(request.getBookingId(), request.getCancellationId(),
                    CancelFailure.NOT_CANCELLABLE, now);
            log.warn("Cancellation refused, no confirmed reservation bookingId={} status={}", bookingId,
                    reservation == null ? null : reservation.getStatus());
            return;
        }
        Hotel hotel = hotels.findById(reservation.getHotelId()).orElseThrow();
        Instant checkInAt = ReservationEvents.checkInAt(hotel, reservation.getCheckIn());
        if (!request.getRequestedAt().isBefore(checkInAt)) {
            events.cancellationFailed(request.getBookingId(), request.getCancellationId(), CancelFailure.TOO_LATE,
                    now);
            log.info("Cancellation refused after the check-in time bookingId={} checkInAt={}", bookingId, checkInAt);
            return;
        }
        inventory.cancelBooked(reservation.getRoomTypeId(), reservation.getCheckIn(), reservation.getCheckOut(),
                reservation.getRooms());
        reservation.cancel(UUID.fromString(request.getCancellationId()), numbers.newCancellationReference(), now);
        events.cancelled(reservation);
        audit.record("HOTEL_RESERVATION_CANCELLED", "HOTEL_RESERVATION", reservation.getId().toString(), Map.of(
                "bookingId", bookingId.toString(),
                "hotelId", reservation.getHotelId().toString(),
                "cancellationId", request.getCancellationId(),
                "cancellationReference", reservation.getCancellationReference(),
                "rooms", String.valueOf(reservation.getRooms()),
                "checkIn", reservation.getCheckIn().toString(),
                "initiatedBy", request.getInitiatedBy()));
        log.info("Reservation cancelled bookingId={} reference={} roomsBackOnSale={}", bookingId,
                reservation.getCancellationReference(), reservation.getRooms());
    }

    /** IDs of holds whose time ran out (the expiry job then handles each one in its own transaction). */
    public List<UUID> expiredHolds(int limit) {
        return reservations.findExpiredHolds(clock.instant(), PageRequest.ofSize(limit));
    }

    /** Puts the rooms of one expired hold back on sale. Safe if another instance did it first. */
    @Transactional
    public boolean expire(UUID reservationId) {
        Instant now = clock.instant();
        HotelReservation reservation = reservations.lockById(reservationId).orElse(null);
        if (reservation == null || !reservation.isHeld() || reservation.getHoldExpiresAt().isAfter(now)) {
            return false;
        }
        inventory.release(reservation.getRoomTypeId(), reservation.getCheckIn(), reservation.getCheckOut(),
                reservation.getRooms());
        reservation.expire(now);
        events.released(reservation, "EXPIRED", now);
        log.info("Hold expired bookingId={} reservationId={}", reservation.getBookingId(), reservationId);
        return true;
    }

    private void fail(UUID bookingId, HoldFailure failure, String hotelName, java.math.BigDecimal newTotal,
            String currency, Instant now) {
        events.holdFailed(bookingId.toString(), failure, hotelName, newTotal, currency, now);
        log.info("Hold failed bookingId={} reason={}", bookingId, failure);
    }

    /** Exactly one guest per room, rooms numbered 1..n, names present. */
    static boolean guestsMatch(List<HotelGuest> guests, int rooms) {
        if (guests == null || guests.size() != rooms) {
            return false;
        }
        Set<Integer> roomNumbers = new HashSet<>();
        for (HotelGuest guest : guests) {
            if (guest.getRoomNo() < 1 || guest.getRoomNo() > rooms || !roomNumbers.add(guest.getRoomNo())
                    || guest.getFirstName().isBlank() || guest.getLastName().isBlank()) {
                return false;
            }
        }
        return true;
    }
}
