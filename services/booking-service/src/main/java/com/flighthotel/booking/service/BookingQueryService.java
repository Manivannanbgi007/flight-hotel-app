package com.flighthotel.booking.service;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.dto.BookingDtos.AttentionView;
import com.flighthotel.booking.dto.BookingDtos.BookingDetails;
import com.flighthotel.booking.dto.BookingDtos.BookingSummary;
import com.flighthotel.booking.dto.BookingDtos.CancellationTerms;
import com.flighthotel.booking.dto.BookingDtos.GuestItem;
import com.flighthotel.booking.dto.BookingDtos.FlightBrief;
import com.flighthotel.booking.dto.BookingDtos.FlightTrip;
import com.flighthotel.booking.dto.BookingDtos.HotelBrief;
import com.flighthotel.booking.dto.BookingDtos.HotelStay;
import com.flighthotel.booking.dto.BookingDtos.PassengerView;
import com.flighthotel.booking.dto.BookingDtos.PriceLine;
import com.flighthotel.booking.dto.BookingDtos.RefundItem;
import com.flighthotel.booking.dto.BookingDtos.SupportNoteView;
import com.flighthotel.booking.dto.BookingDtos.SliceView;
import com.flighthotel.booking.dto.BookingDtos.TimelineEntry;
import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingPassenger;
import com.flighthotel.booking.entity.BookingTab;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.FlightBooking;
import com.flighthotel.booking.entity.HotelBooking;
import com.flighthotel.booking.entity.RefundRequest;
import com.flighthotel.booking.repository.BookingPassengerRepository;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.repository.BookingStatusChangeRepository;
import com.flighthotel.booking.repository.CancellationRepository;
import com.flighthotel.booking.repository.FlightBookingRepository;
import com.flighthotel.booking.repository.HotelBookingRepository;
import com.flighthotel.booking.repository.RefundRequestRepository;
import com.flighthotel.booking.repository.SupportNoteRepository;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.web.PageResponse;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * My Trips and booking details. A customer only sees their own bookings (someone else's answers 404); support agents
 * and admins with {@code BOOKING_READ_ANY} see every booking.
 */
@Service
@PreAuthorize("isAuthenticated()")
public class BookingQueryService {

    static final String READ_ANY = "BOOKING_READ_ANY";
    private static final int MAX_PAGE_SIZE = 50;

    private final BookingRepository bookings;
    private final HotelBookingRepository hotelBookings;
    private final FlightBookingRepository flightBookings;
    private final BookingPassengerRepository passengers;
    private final BookingStatusChangeRepository history;
    private final CancellationRepository cancellations;
    private final RefundRequestRepository refunds;
    private final SupportNoteRepository notes;
    private final JsonMapper json;
    private final Clock clock;

    public BookingQueryService(BookingRepository bookings, HotelBookingRepository hotelBookings,
            FlightBookingRepository flightBookings, BookingPassengerRepository passengers,
            BookingStatusChangeRepository history, CancellationRepository cancellations,
            RefundRequestRepository refunds, SupportNoteRepository notes, JsonMapper json, Clock clock) {
        this.bookings = bookings;
        this.hotelBookings = hotelBookings;
        this.flightBookings = flightBookings;
        this.passengers = passengers;
        this.history = history;
        this.cancellations = cancellations;
        this.refunds = refunds;
        this.notes = notes;
        this.json = json;
        this.clock = clock;
    }

    /**
     * My Trips: the signed-in customer's bookings, newest first. {@code query} finds a booking reference, or words of
     * the title or destination; {@code type} keeps hotels or flights. Each card also carries the few facts of its stay
     * or flight, read for the whole page in three queries (no query per booking).
     */
    @Transactional(readOnly = true)
    public PageResponse<BookingSummary> myBookings(BookingTab tab, String query, BookingType type, int page,
            int size) {
        UUID userId = CurrentUser.require().id();
        PageRequest request = PageRequest.of(Math.max(page, 0), Math.clamp(size, 1, MAX_PAGE_SIZE),
                Sort.by(Sort.Direction.DESC, "createdAt").and(Sort.by(Sort.Direction.DESC, "id")));
        java.time.Instant now = clock.instant();
        String text = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
        Specification<Booking> filter = (root, criteria, cb) -> {
            List<jakarta.persistence.criteria.Predicate> where = new ArrayList<>();
            where.add(cb.equal(root.get("userId"), userId));
            where.add(root.get("status").in(tab.statuses()));
            if (type != null) {
                where.add(cb.equal(root.get("bookingType"), type));
            }
            if (!text.isEmpty()) {
                String like = "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
                where.add(cb.or(cb.like(cb.lower(root.get("bookingReference")), like, '\\'),
                        cb.like(cb.lower(root.get("title")), like, '\\'),
                        cb.like(cb.lower(root.get("destination")), like, '\\')));
            }
            return cb.and(where.toArray(jakarta.persistence.criteria.Predicate[]::new));
        };
        org.springframework.data.domain.Page<Booking> found = bookings.findAll(filter, request);
        List<UUID> ids = found.getContent().stream().map(Booking::getId).toList();
        Map<UUID, HotelBooking> hotels = hotelBookings.findAllById(ids).stream()
                .collect(Collectors.toMap(HotelBooking::getBookingId, Function.identity()));
        Map<UUID, FlightBooking> flights = flightBookings.findAllById(ids).stream()
                .collect(Collectors.toMap(FlightBooking::getBookingId, Function.identity()));
        Map<UUID, List<BookingPassenger>> travellers = ids.isEmpty() ? Map.of()
                : passengers.findByBookingIdInOrderByBookingIdAscPassengerNoAsc(ids).stream()
                        .collect(Collectors.groupingBy(BookingPassenger::getBookingId));
        return PageResponse.from(found, booking -> summary(booking, now, hotels.get(booking.getId()),
                flights.get(booking.getId()), travellers.getOrDefault(booking.getId(), List.of())));
    }

    @Transactional(readOnly = true)
    public BookingDetails details(UUID bookingId) {
        Booking booking = readable(bookingId);
        boolean staff = CurrentUser.require().hasPermission(READ_ANY);
        HotelBooking hotel = hotelBookings.findById(bookingId).orElse(null);
        return new BookingDetails(booking.getId(), booking.getBookingReference(), booking.getBookingType(),
                booking.getStatus(), booking.getPaymentStatus(), booking.getTitle(), booking.getDestination(),
                booking.getStartDate(), booking.getEndDate(), booking.getCurrency(), booking.getBaseAmount(),
                booking.getTaxAmount(), booking.getFeeAmount(), booking.getDiscountAmount(), booking.getTotalAmount(),
                booking.getPriceItems().stream()
                        .map(item -> new PriceLine(item.getItemType(), item.getLabel(), item.getAmount())).toList(),
                booking.getCouponCode(), booking.getCouponNote(), booking.getContactEmail(), booking.getContactPhone(),
                booking.getCreatedAt(), booking.getHoldExpiresAt(), booking.getPaymentDeadline(),
                booking.getConfirmedAt(), booking.getFailureReason(), booking.getFailureMessage(),
                booking.isPayable(clock.instant()), "DEMO".equals(booking.getInventorySource()),
                hotel == null ? null : stay(booking, hotel),
                booking.getBookingType() == BookingType.FLIGHT ? trip(booking) : null,
                CancellationPolicy.canCancel(booking, clock.instant()),
                cancellations.findFirstByBookingIdOrderByRequestedAtDesc(bookingId).map(CancellationService::view)
                        .orElse(null),
                booking.getRefundedAmount(),
                refunds.findByBookingIdOrderByRequestedAtAsc(bookingId).stream().map(BookingQueryService::refundItem)
                        .toList(),
                staff && booking.getAttentionReason() != null ? new AttentionView(booking.getAttentionReason(),
                        booking.getAttentionNote(), booking.getAttentionSince()) : null,
                staff ? notes.findByBookingIdOrderByCreatedAtAscIdAsc(bookingId).stream()
                        .map(n -> new SupportNoteView(n.getAction(), n.getNote(), n.getAuthorRole(), n.getCreatedAt()))
                        .toList() : List.of());
    }

    static RefundItem refundItem(RefundRequest refund) {
        return new RefundItem(refund.getId(), refund.getAmount(), refund.getCurrency(), refund.getReason(),
                refund.getStatus(), refund.getRequestedAt(), refund.getCompletedAt());
    }

    /** Golden rule 3: the PNR and the ticket numbers are only shown once the airline confirmed. */
    private FlightTrip trip(Booking booking) {
        FlightBooking flight = flightBookings.findById(booking.getId()).orElse(null);
        if (flight == null) {
            return null;
        }
        boolean issued = booking.getConfirmedAt() != null;
        List<SliceView> slices = flight.getSlicesJson() == null ? List.of()
                : json.readValue(flight.getSlicesJson(), new TypeReference<List<SliceView>>() { });
        List<PassengerView> travellers = passengers.findByBookingIdOrderByPassengerNo(booking.getId()).stream()
                .map(p -> new PassengerView(p.getPassengerNo(), p.getPassengerType(), p.getFirstName(),
                        p.getLastName(), p.getDateOfBirth(), p.getGender(), p.getNationality(), p.getPassportLast4(),
                        issued ? p.getTicketNumber() : null))
                .toList();
        return new FlightTrip(flight.getOfferId(), flight.getTripType(), flight.getCabin(), flight.getFareName(),
                flight.getRefundable(), flight.getCheckedBaggageKg(), flight.getCabinBaggageKg(),
                flight.getCancellationFeePercent(), booking.getCancellationPolicySnapshot(), flight.getAdults(),
                flight.getChildren(), flight.getInfants(), flight.isDemo(), issued ? flight.getPnr() : null, slices,
                travellers);
    }

    @Transactional(readOnly = true)
    public List<TimelineEntry> timeline(UUID bookingId) {
        readable(bookingId);
        return history.findByBookingIdOrderByChangedAtAscIdAsc(bookingId).stream()
                .map(change -> new TimelineEntry(change.getFromStatus(), change.getToStatus(), change.getReason(),
                        change.getChangedAt()))
                .toList();
    }

    private Booking readable(UUID bookingId) {
        AuthenticatedUser user = CurrentUser.require();
        return bookings.findById(bookingId)
                .filter(booking -> booking.getUserId().equals(user.id()) || user.hasPermission(READ_ANY))
                .orElseThrow(() -> new ResourceNotFoundException("Booking", bookingId));
    }

    private BookingSummary summary(Booking booking, java.time.Instant now, HotelBooking hotel, FlightBooking flight,
            List<BookingPassenger> travellers) {
        HotelBrief stay = hotel == null ? null : new HotelBrief(hotel.getHotelSlug(), hotel.getHotelName(),
                hotel.getHotelCity(), hotel.getRoomTypeName(), hotel.getRooms(), hotel.getAdults(), hotel.getChildren(),
                hotel.getNights());
        FlightBrief trip = flight == null ? null : new FlightBrief(flight.getTripType(), flight.getCabin(),
                flight.getAdults(), flight.getChildren(), flight.getInfants(),
                travellers.stream().map(p -> (p.getFirstName() + " " + p.getLastName()).strip()).toList(),
                flight.getSlicesJson() == null ? List.of()
                        : json.readValue(flight.getSlicesJson(), new TypeReference<List<SliceView>>() { }));
        return new BookingSummary(booking.getId(), booking.getBookingReference(), booking.getBookingType(),
                booking.getStatus(), booking.getPaymentStatus(), booking.getTitle(), booking.getDestination(),
                booking.getStartDate(), booking.getEndDate(), booking.getTotalAmount(), booking.getCurrency(),
                booking.getCreatedAt(), "DEMO".equals(booking.getInventorySource()),
                CancellationPolicy.canCancel(booking, now), stay, trip);
    }

    private static HotelStay stay(Booking booking, HotelBooking hotel) {
        return new HotelStay(hotel.getQuoteId(), hotel.getHotelId(), hotel.getHotelSlug(), hotel.getHotelName(),
                hotel.getHotelCity(), hotel.getHotelAddress(), hotel.getRoomTypeName(), hotel.getRatePlanName(),
                hotel.getBreakfastIncluded(), hotel.getCheckIn(), hotel.getCheckOut(), hotel.getCheckInTime(),
                hotel.getCheckOutTime(), hotel.getNights(), hotel.getRooms(), hotel.getAdults(), hotel.getChildren(),
                // Golden rule 3: no confirmation number before the hotel confirmed (kept after a cancellation).
                booking.getConfirmedAt() != null ? hotel.getConfirmationNumber() : null,
                hotel.getGuests().stream()
                        .map(guest -> new GuestItem(guest.getRoomNo(), guest.getFirstName(), guest.getLastName()))
                        .toList(),
                hotel.getSpecialRequests(),
                hotel.getRefundable() == null ? null : new CancellationTerms(hotel.getRefundable(),
                        hotel.getFreeCancellationUntil(), hotel.getCancellationFeePercent(),
                        booking.getCancellationPolicySnapshot()));
    }
}
