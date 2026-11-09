package com.flighthotel.hotel.reservation;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.Roles;
import com.flighthotel.events.hotel.GuestCheckedIn;
import com.flighthotel.events.hotel.GuestCheckedOut;
import com.flighthotel.events.hotel.HeldTaxLine;
import com.flighthotel.events.hotel.HotelInventoryHeld;
import com.flighthotel.events.hotel.HotelInventoryHoldFailed;
import com.flighthotel.events.hotel.HotelInventoryReleased;
import com.flighthotel.events.hotel.HotelReservationCancellationFailed;
import com.flighthotel.events.hotel.HotelReservationCancelled;
import com.flighthotel.events.hotel.HotelReservationConfirmed;
import com.flighthotel.events.hotel.HotelReservationFailed;
import com.flighthotel.hotel.dto.PublicHotelDtos.TaxLine;
import com.flighthotel.hotel.entity.CancelledBy;
import com.flighthotel.hotel.entity.DataSource;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelReservation;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.pricing.PricingService.CancellationTerms;
import com.flighthotel.hotel.staff.HotelStaffStore;

/**
 * The saga answers hotel-service gives booking-service, and what the front desk does with a stay (check-in,
 * check-out, the hotel's own cancellation) ({@code hotel.events}, key = booking id, so all events of one booking stay
 * in order). Written to the outbox in the caller's transaction.
 */
@Component
public class ReservationEvents {

    static final String AGGREGATE_TYPE = "hotel";
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");

    private final OutboxEventPublisher outbox;
    private final RealtimePublisher realtime;
    private final HotelStaffStore staff;

    public ReservationEvents(OutboxEventPublisher outbox, RealtimePublisher realtime, HotelStaffStore staff) {
        this.outbox = outbox;
        this.realtime = realtime;
        this.staff = staff;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void held(HotelReservation reservation, Hotel hotel, RoomType room, RatePlan plan, List<TaxLine> taxLines,
            CancellationTerms terms, Instant now) {
        String currency = reservation.getCurrency();
        outbox.publish(AGGREGATE_TYPE, reservation.getBookingId().toString(), HotelInventoryHeld.newBuilder()
                .setBookingId(reservation.getBookingId().toString())
                .setReservationId(reservation.getId().toString())
                .setHotelId(hotel.getId().toString())
                .setHotelSlug(hotel.getSlug())
                .setHotelName(hotel.getName())
                .setHotelCity(hotel.getCity())
                .setHotelAddress(hotel.getAddressLine() + ", " + hotel.getCity())
                .setCountryCode(hotel.getCountryCode())
                .setRoomTypeId(room.getId().toString())
                .setRoomTypeName(room.getName())
                .setRatePlanName(plan.getName())
                .setBreakfastIncluded(plan.isBreakfastIncluded())
                .setCheckIn(reservation.getCheckIn())
                .setCheckOut(reservation.getCheckOut())
                .setCheckInTime(TIME.format(hotel.getCheckInTime()))
                .setCheckOutTime(TIME.format(hotel.getCheckOutTime()))
                .setNights((int) java.time.temporal.ChronoUnit.DAYS.between(reservation.getCheckIn(),
                        reservation.getCheckOut()))
                .setRooms(reservation.getRooms())
                .setAdults(reservation.getAdults())
                .setChildren(reservation.getChildren())
                .setSubtotal(EventMoney.of(reservation.getSubtotal(), currency))
                .setTaxes(EventMoney.of(reservation.getTaxes(), currency))
                .setTaxLines(taxLines.stream()
                        .map(line -> HeldTaxLine.newBuilder().setLabel(line.label())
                                .setAmount(EventMoney.of(line.amount(), currency)).build())
                        .toList())
                .setTotal(EventMoney.of(reservation.getTotalAmount(), currency))
                .setRefundable(plan.isRefundable())
                .setFreeCancellationUntil(terms.freeUntil())
                .setCancellationFeePercent(EventMoney.scale(terms.feePercent()))
                .setCancellationPolicy(terms.description())
                .setDemo(hotel.getDataSource() == DataSource.DEMO)
                .setHoldExpiresAt(reservation.getHoldExpiresAt())
                .setHeldAt(now)
                .setCheckInAt(checkInAt(hotel, reservation.getCheckIn()))
                .build());
        reservationChanged(hotel.getId());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void holdFailed(String bookingId, HoldFailure failure, String hotelName, BigDecimal newTotal,
            String currency, Instant now) {
        outbox.publish(AGGREGATE_TYPE, bookingId, HotelInventoryHoldFailed.newBuilder()
                .setBookingId(bookingId)
                .setReason(failure.name())
                .setMessage(failure.message())
                .setNewTotal(newTotal == null ? null : EventMoney.of(newTotal, currency))
                .setHotelName(hotelName)
                .setFailedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void confirmed(HotelReservation reservation, Instant now) {
        outbox.publish(AGGREGATE_TYPE, reservation.getBookingId().toString(), HotelReservationConfirmed.newBuilder()
                .setBookingId(reservation.getBookingId().toString())
                .setReservationId(reservation.getId().toString())
                .setConfirmationNumber(reservation.getConfirmationNumber())
                .setConfirmedAt(now)
                .build());
        reservationChanged(reservation.getHotelId());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void confirmationFailed(HotelReservation reservation, String reason, Instant now) {
        outbox.publish(AGGREGATE_TYPE, reservation.getBookingId().toString(), HotelReservationFailed.newBuilder()
                .setBookingId(reservation.getBookingId().toString())
                .setReservationId(reservation.getId().toString())
                .setReason(reason)
                .setFailedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void released(HotelReservation reservation, String reason, Instant now) {
        outbox.publish(AGGREGATE_TYPE, reservation.getBookingId().toString(), HotelInventoryReleased.newBuilder()
                .setBookingId(reservation.getBookingId().toString())
                .setReservationId(reservation.getId().toString())
                .setReason(reason)
                .setReleasedAt(now)
                .build());
        reservationChanged(reservation.getHotelId());
    }

    /**
     * The booked rooms are back on sale. For the customer's cancellation it is the answer to
     * BookingCancellationRequested (repeatable with the same content); for the hotel's own cancellation
     * ({@code initiatedBy = HOTEL}, with the hotel's reason and a cancellation id made here) booking-service records
     * the cancellation and refunds the guest in full.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void cancelled(HotelReservation reservation) {
        CancelledBy by = reservation.getCancelledBy() == null ? CancelledBy.CUSTOMER : reservation.getCancelledBy();
        outbox.publish(AGGREGATE_TYPE, reservation.getBookingId().toString(), HotelReservationCancelled.newBuilder()
                .setBookingId(reservation.getBookingId().toString())
                .setReservationId(reservation.getId().toString())
                .setCancellationId(reservation.getCancellationId().toString())
                .setCancellationReference(reservation.getCancellationReference())
                .setCancelledAt(reservation.getCancelledAt())
                .setInitiatedBy(by.name())
                .setReason(by == CancelledBy.HOTEL ? reservation.getCancellationReason() : null)
                .build());
        reservationChanged(reservation.getHotelId());
    }

    /** The front desk checked the guests in. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void checkedIn(HotelReservation reservation) {
        outbox.publish(AGGREGATE_TYPE, reservation.getBookingId().toString(), GuestCheckedIn.newBuilder()
                .setBookingId(reservation.getBookingId().toString())
                .setReservationId(reservation.getId().toString())
                .setHotelId(reservation.getHotelId().toString())
                .setAt(reservation.getCheckedInAt())
                .build());
        reservationChanged(reservation.getHotelId());
    }

    /** The front desk checked the guests out: booking-service completes the booking. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void checkedOut(HotelReservation reservation) {
        outbox.publish(AGGREGATE_TYPE, reservation.getBookingId().toString(), GuestCheckedOut.newBuilder()
                .setBookingId(reservation.getBookingId().toString())
                .setReservationId(reservation.getId().toString())
                .setHotelId(reservation.getHotelId().toString())
                .setAt(reservation.getCheckedOutAt())
                .build());
        reservationChanged(reservation.getHotelId());
    }

    /** The guests never arrived. No event for other services (the booking stays paid); the hotel's screens refresh. */
    public void noShow(HotelReservation reservation) {
        reservationChanged(reservation.getHotelId());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void cancellationFailed(String bookingId, String cancellationId, CancelFailure failure, Instant now) {
        outbox.publish(AGGREGATE_TYPE, bookingId, HotelReservationCancellationFailed.newBuilder()
                .setBookingId(bookingId)
                .setCancellationId(cancellationId)
                .setReason(failure.name())
                .setMessage(failure.message())
                .setFailedAt(now)
                .build());
    }

    /** The check-in moment in the hotel's own time zone: the last moment a stay can be cancelled. */
    public static Instant checkInAt(Hotel hotel, LocalDate checkIn) {
        return LocalDateTime.of(checkIn, hotel.getCheckInTime()).atZone(ZoneId.of(hotel.getTimeZone())).toInstant();
    }

    /** The hotel's managers (and admins) see their inventory calendar and reservations refresh. */
    private void reservationChanged(java.util.UUID hotelId) {
        List<java.util.UUID> managers = staff.managersOf(hotelId).stream().map(HotelStaffStore.StaffMember::userId)
                .toList();
        RealtimeAudience audience = managers.isEmpty()
                ? RealtimeAudience.roles(Roles.ADMIN)
                : RealtimeAudience.users(managers).andRoles(Roles.ADMIN);
        Map<String, Object> data = Map.of("hotelId", hotelId.toString());
        realtime.publish(RealtimeMessage.of("hotel.reservation-changed", "HOTEL", hotelId.toString(), data), audience);
        realtime.publish(RealtimeMessage.of("hotel.inventory-changed", "HOTEL", hotelId.toString(), data), audience);
    }

    /** Why a confirmed stay could not be cancelled; the message is shown to the customer. */
    public enum CancelFailure {
        TOO_LATE("The check-in time has passed, so the hotel can no longer cancel this stay."),
        NOT_CANCELLABLE("The hotel has no confirmed reservation to cancel for this booking.");

        private final String message;

        CancelFailure(String message) {
            this.message = message;
        }

        public String message() {
            return message;
        }
    }

    /** Why rooms could not be held; the message is shown to the customer. */
    public enum HoldFailure {
        QUOTE_EXPIRED("The price you selected has expired. Please check availability again."),
        SOLD_OUT("These rooms are no longer available for your dates."),
        PRICE_CHANGED("The price for this stay has changed since you selected it."),
        INVALID_GUESTS("Please enter one guest name for each room.");

        private final String message;

        HoldFailure(String message) {
            this.message = message;
        }

        public String message() {
            return message;
        }
    }
}
