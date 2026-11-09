package com.flighthotel.hotel.frontdesk;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.hotel.dto.FrontDeskDtos.DateField;
import com.flighthotel.hotel.dto.FrontDeskDtos.GuestItem;
import com.flighthotel.hotel.dto.FrontDeskDtos.ReservationDetails;
import com.flighthotel.hotel.dto.FrontDeskDtos.ReservationRow;
import com.flighthotel.hotel.dto.FrontDeskDtos.ReservationSummary;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelReservation;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.ReservationStatus;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.inventory.InventoryService;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.HotelReservationRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.reservation.ReservationEvents;
import com.flighthotel.hotel.reservation.ReservationNumbers;
import com.flighthotel.hotel.staff.HotelAccess;

/**
 * The hotel's front desk (API_DOCUMENTATION.md §14.5): reservations and guests, check-in, check-out, no-show and the
 * hotel's own cancellations. Same access rule as every manager screen ({@code 403 HOTEL_NOT_ASSIGNED}); every change
 * locks the reservation row, so it never races booking-service's cancellation of the same stay.
 * <p>
 * Dates are the hotel's own (its time zone):
 * <ul>
 *   <li><b>Check-in</b> CONFIRMED → CHECKED_IN: from the check-in day until the check-out time on the check-out day
 *       (late arrivals after midnight included). Earlier or later: {@code 422 NOT_CHECK_IN_DAY}.</li>
 *   <li><b>Check-out</b> CHECKED_IN → CHECKED_OUT: any time, also before the booked check-out date. The booking is
 *       then completed ({@code GuestCheckedOut}). Nights from today on are put back on sale (the guest is gone);
 *       the stay stays paid, so its revenue is kept.</li>
 *   <li><b>No-show</b> CONFIRMED → NO_SHOW: from the day after the check-in date ({@code 422 NO_SHOW_TOO_EARLY}).
 *       Nights from today on go back on sale; the nights that passed stay sold, and the stay stays paid (no refund),
 *       so it keeps its revenue.</li>
 *   <li><b>Cancel by the hotel</b> (overbooking, closure) CONFIRMED → CANCELLED until the end of the check-in day
 *       ({@code 422 TOO_LATE_TO_CANCEL}; a guest who never came is a no-show). All nights go back on sale; a new
 *       cancellation id and an {@code HX…} number are made here and {@code HotelReservationCancelled{initiatedBy =
 *       HOTEL}} tells booking-service to refund the guest in full.</li>
 *   <li>Any other state: {@code 409 INVALID_RESERVATION_STATE}.</li>
 * </ul>
 * No-shows and hotel cancellations are audited (ids and dates only, never the reason or guest data). Every change
 * refreshes the hotel's screens ({@code hotel.reservation-changed}).
 */
@Service
@PreAuthorize("hasAnyAuthority('HOTEL_MANAGE_ANY', 'HOTEL_MANAGE_ASSIGNED')")
public class FrontDeskService {

    private static final Logger log = LoggerFactory.getLogger(FrontDeskService.class);

    private final HotelAccess access;
    private final HotelRepository hotels;
    private final HotelReservationRepository reservations;
    private final RoomTypeRepository roomTypes;
    private final RatePlanRepository ratePlans;
    private final ReservationQueries queries;
    private final InventoryService inventory;
    private final ReservationEvents events;
    private final ReservationNumbers numbers;
    private final AuditPublisher audit;
    private final Clock clock;

    public FrontDeskService(HotelAccess access, HotelRepository hotels, HotelReservationRepository reservations,
            RoomTypeRepository roomTypes, RatePlanRepository ratePlans, ReservationQueries queries,
            InventoryService inventory, ReservationEvents events, ReservationNumbers numbers, AuditPublisher audit,
            Clock clock) {
        this.access = access;
        this.hotels = hotels;
        this.reservations = reservations;
        this.roomTypes = roomTypes;
        this.ratePlans = ratePlans;
        this.queries = queries;
        this.inventory = inventory;
        this.events = events;
        this.numbers = numbers;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * @param statuses none = every paid reservation (held, expired and released ones only when asked for)
     * @param from     / to: days (inclusive) of the check-in date or of the booking date ({@code dateField})
     */
    @Transactional(readOnly = true)
    public PageResponse<ReservationRow> list(UUID hotelId, List<ReservationStatus> statuses, LocalDate from,
            LocalDate to, DateField dateField, String q, UUID roomTypeId, Pageable pageable) {
        access.requireManage(hotelId);
        if (from != null && to != null && to.isBefore(from)) {
            throw new BusinessRuleException("INVALID_DATE_RANGE", "The end date must not be before the start date.");
        }
        Hotel hotel = hotel(hotelId);
        requireRoomType(hotelId, roomTypeId);
        return PageResponse.from(queries.find(hotelId, statuses, from, to,
                dateField == null ? DateField.CHECK_IN : dateField, q, roomTypeId, zone(hotel), pageable));
    }

    /** The counts above the list: reservations per status for the same dates, search words and room type. */
    @Transactional(readOnly = true)
    public ReservationSummary summary(UUID hotelId, LocalDate from, LocalDate to, DateField dateField, String q,
            UUID roomTypeId) {
        access.requireManage(hotelId);
        if (from != null && to != null && to.isBefore(from)) {
            throw new BusinessRuleException("INVALID_DATE_RANGE", "The end date must not be before the start date.");
        }
        Hotel hotel = hotel(hotelId);
        requireRoomType(hotelId, roomTypeId);
        Map<ReservationStatus, Long> counts = queries.statusCounts(hotelId, from, to,
                dateField == null ? DateField.CHECK_IN : dateField, q, roomTypeId, zone(hotel));
        long paid = ReservationQueries.PAID.stream().mapToLong(status -> counts.getOrDefault(status, 0L)).sum();
        return new ReservationSummary(paid, counts.getOrDefault(ReservationStatus.CONFIRMED, 0L),
                counts.getOrDefault(ReservationStatus.HELD, 0L), counts.getOrDefault(ReservationStatus.CHECKED_IN, 0L),
                counts.getOrDefault(ReservationStatus.CHECKED_OUT, 0L), counts.getOrDefault(ReservationStatus.CANCELLED, 0L),
                counts.getOrDefault(ReservationStatus.NO_SHOW, 0L));
    }

    /** A room type filter must name a room type of this hotel (404 otherwise, never another hotel's). */
    private void requireRoomType(UUID hotelId, UUID roomTypeId) {
        if (roomTypeId != null) {
            roomTypes.findByIdAndHotelId(roomTypeId, hotelId)
                    .orElseThrow(() -> new ResourceNotFoundException("Room type", roomTypeId));
        }
    }

    @Transactional(readOnly = true)
    public ReservationDetails details(UUID hotelId, UUID reservationId) {
        access.requireManage(hotelId);
        return details(reservations.findByIdAndHotelId(reservationId, hotelId)
                .orElseThrow(() -> new ResourceNotFoundException("Reservation", reservationId)));
    }

    @Transactional
    public ReservationDetails checkIn(UUID hotelId, UUID reservationId) {
        access.requireManage(hotelId);
        HotelReservation reservation = lock(hotelId, reservationId);
        requireStatus(reservation, ReservationStatus.CONFIRMED, "Only a confirmed stay can be checked in.");
        Hotel hotel = hotel(hotelId);
        Instant now = clock.instant();
        LocalDate today = LocalDate.ofInstant(now, zone(hotel));
        Instant checkOutAt = LocalDateTime.of(reservation.getCheckOut(), hotel.getCheckOutTime()).atZone(zone(hotel))
                .toInstant();
        if (today.isBefore(reservation.getCheckIn()) || !now.isBefore(checkOutAt)) {
            throw new BusinessRuleException("NOT_CHECK_IN_DAY",
                    "Guests can be checked in from the check-in day until the check-out time.",
                    Map.of("checkIn", reservation.getCheckIn().toString(),
                            "checkOut", reservation.getCheckOut().toString(), "today", today.toString()));
        }
        reservation.checkIn(now);
        events.checkedIn(reservation);
        log.info("Guests checked in reservationId={} bookingId={}", reservationId, reservation.getBookingId());
        return details(reservation);
    }

    @Transactional
    public ReservationDetails checkOut(UUID hotelId, UUID reservationId) {
        access.requireManage(hotelId);
        HotelReservation reservation = lock(hotelId, reservationId);
        requireStatus(reservation, ReservationStatus.CHECKED_IN, "Only checked-in guests can be checked out.");
        Instant now = clock.instant();
        LocalDate today = LocalDate.ofInstant(now, zone(hotel(hotelId)));
        reservation.checkOut(now);
        int released = releaseNightsToCome(reservation, today);
        events.checkedOut(reservation);
        log.info("Guests checked out reservationId={} bookingId={} nightsBackOnSale={}", reservationId,
                reservation.getBookingId(), released);
        return details(reservation);
    }

    @Transactional
    public ReservationDetails noShow(UUID hotelId, UUID reservationId) {
        access.requireManage(hotelId);
        HotelReservation reservation = lock(hotelId, reservationId);
        requireStatus(reservation, ReservationStatus.CONFIRMED, "Only a confirmed stay can be marked as no-show.");
        Instant now = clock.instant();
        LocalDate today = LocalDate.ofInstant(now, zone(hotel(hotelId)));
        if (!today.isAfter(reservation.getCheckIn())) {
            throw new BusinessRuleException("NO_SHOW_TOO_EARLY",
                    "A guest can be marked as no-show from the day after the check-in date.",
                    Map.of("checkIn", reservation.getCheckIn().toString(), "today", today.toString()));
        }
        reservation.markNoShow(now);
        int released = releaseNightsToCome(reservation, today);
        events.noShow(reservation);
        audit.record("HOTEL_RESERVATION_NO_SHOW", "HOTEL_RESERVATION", reservationId.toString(), Map.of(
                "bookingId", reservation.getBookingId().toString(),
                "hotelId", hotelId.toString(),
                "checkIn", reservation.getCheckIn().toString(),
                "nightsBackOnSale", String.valueOf(released)));
        log.info("No-show recorded reservationId={} bookingId={} nightsBackOnSale={}", reservationId,
                reservation.getBookingId(), released);
        return details(reservation);
    }

    @Transactional
    public ReservationDetails cancel(UUID hotelId, UUID reservationId, String reason) {
        access.requireManage(hotelId);
        HotelReservation reservation = lock(hotelId, reservationId);
        requireStatus(reservation, ReservationStatus.CONFIRMED,
                "Only a confirmed stay whose guests have not arrived can be cancelled by the hotel.");
        Instant now = clock.instant();
        LocalDate today = LocalDate.ofInstant(now, zone(hotel(hotelId)));
        if (today.isAfter(reservation.getCheckIn())) {
            throw new BusinessRuleException("TOO_LATE_TO_CANCEL",
                    "The check-in day has passed. If the guests did not arrive, record a no-show instead.",
                    Map.of("checkIn", reservation.getCheckIn().toString(), "today", today.toString()));
        }
        inventory.cancelBooked(reservation.getRoomTypeId(), reservation.getCheckIn(), reservation.getCheckOut(),
                reservation.getRooms());
        reservation.cancelByHotel(UuidV7.generate(), numbers.newCancellationReference(), reason.strip(), now);
        events.cancelled(reservation);
        audit.record("HOTEL_RESERVATION_CANCELLED", "HOTEL_RESERVATION", reservationId.toString(), Map.of(
                "bookingId", reservation.getBookingId().toString(),
                "hotelId", hotelId.toString(),
                "cancellationId", reservation.getCancellationId().toString(),
                "cancellationReference", reservation.getCancellationReference(),
                "rooms", String.valueOf(reservation.getRooms()),
                "checkIn", reservation.getCheckIn().toString(),
                "initiatedBy", "HOTEL"));
        log.info("Reservation cancelled by the hotel reservationId={} bookingId={} reference={} roomsBackOnSale={}",
                reservationId, reservation.getBookingId(), reservation.getCancellationReference(),
                reservation.getRooms());
        return details(reservation);
    }

    /** Nights from today (at the hotel) until check-out go back on sale. @return how many nights */
    private int releaseNightsToCome(HotelReservation reservation, LocalDate today) {
        LocalDate from = today.isAfter(reservation.getCheckIn()) ? today : reservation.getCheckIn();
        if (!from.isBefore(reservation.getCheckOut())) {
            return 0;
        }
        inventory.cancelBooked(reservation.getRoomTypeId(), from, reservation.getCheckOut(), reservation.getRooms());
        return (int) ChronoUnit.DAYS.between(from, reservation.getCheckOut());
    }

    private ReservationDetails details(HotelReservation reservation) {
        String roomType = roomTypes.findById(reservation.getRoomTypeId()).map(RoomType::getName).orElse(null);
        String ratePlan = ratePlans.findById(reservation.getRatePlanId()).map(RatePlan::getName).orElse(null);
        return new ReservationDetails(reservation.getId(), reservation.getBookingId(),
                reservation.getBookingReference(), reservation.getStatus(), reservation.getCheckIn(),
                reservation.getCheckOut(), reservation.nights(), reservation.getRooms(), reservation.getAdults(),
                reservation.getChildren(), roomType, ratePlan,
                reservation.leadGuest().map(g -> g.getFirstName() + " " + g.getLastName()).orElse(null),
                reservation.getSubtotal(), reservation.getTaxes(), reservation.getTotalAmount(),
                reservation.getCurrency(), reservation.getConfirmationNumber(), reservation.getCreatedAt(),
                reservation.getGuests().stream()
                        .map(g -> new GuestItem(g.getRoomNo(), g.getFirstName(), g.getLastName())).toList(),
                reservation.getContactEmail(), reservation.getContactPhone(), reservation.getSpecialRequests(),
                reservation.getConfirmedAt(), reservation.getCheckedInAt(), reservation.getCheckedOutAt(),
                reservation.getNoShowAt(), reservation.getCancelledAt(), reservation.getCancellationReference(),
                reservation.getCancelledBy(), reservation.getCancellationReason());
    }

    private HotelReservation lock(UUID hotelId, UUID reservationId) {
        return reservations.lockById(reservationId).filter(r -> r.getHotelId().equals(hotelId))
                .orElseThrow(() -> new ResourceNotFoundException("Reservation", reservationId));
    }

    private static void requireStatus(HotelReservation reservation, ReservationStatus expected, String message) {
        if (reservation.getStatus() != expected) {
            throw new ApiException(HttpStatus.CONFLICT, "INVALID_RESERVATION_STATE", message,
                    Map.of("status", reservation.getStatus().name()));
        }
    }

    private Hotel hotel(UUID hotelId) {
        return hotels.findById(hotelId).orElseThrow(() -> new ResourceNotFoundException("Hotel", hotelId));
    }

    private static ZoneId zone(Hotel hotel) {
        return ZoneId.of(hotel.getTimeZone());
    }
}
