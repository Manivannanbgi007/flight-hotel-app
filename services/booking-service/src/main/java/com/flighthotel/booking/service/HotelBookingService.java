package com.flighthotel.booking.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.dto.BookingDtos.CreateHotelBookingRequest;
import com.flighthotel.booking.dto.BookingDtos.GuestName;
import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingGuest;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.HotelBooking;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.repository.HotelBookingRepository;
import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;

/**
 * Step 1 of the hotel booking saga: record the customer's request ({@code INITIATED}) and ask hotel-service to hold
 * the rooms ({@code BookingInitiated}). Nothing is reserved or priced here; that is hotel-service's answer.
 * <p>
 * Idempotent per customer and {@code Idempotency-Key}: repeating the request (double click, retry after a timeout)
 * returns the same booking; reusing the key for a different request is refused.
 */
@Service
public class HotelBookingService {

    private static final Logger log = LoggerFactory.getLogger(HotelBookingService.class);
    private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("^[A-Za-z0-9_-]{8,100}$");

    private final BookingRepository bookings;
    private final HotelBookingRepository hotelBookings;
    private final BookingReferences references;
    private final CouponService coupons;
    private final BookingLifecycle lifecycle;
    private final BookingEvents events;

    public HotelBookingService(BookingRepository bookings, HotelBookingRepository hotelBookings,
            BookingReferences references, CouponService coupons, BookingLifecycle lifecycle, BookingEvents events) {
        this.bookings = bookings;
        this.hotelBookings = hotelBookings;
        this.references = references;
        this.coupons = coupons;
        this.lifecycle = lifecycle;
        this.events = events;
    }

    /** @return the booking and whether it was created now (false: the same request was sent before) */
    @PreAuthorize("isAuthenticated()")
    @Transactional
    public Submitted create(CreateHotelBookingRequest request, String idempotencyKey) {
        AuthenticatedUser user = CurrentUser.require();
        String key = requireKey(idempotencyKey);
        Booking existing = findRepeat(user.id(), key, request);
        if (existing != null) {
            return new Submitted(existing.getId(), false);
        }

        List<BookingGuest> guests = guests(request.guests());
        String coupon = coupons.checkForNewBooking(request.couponCode(), BookingType.HOTEL, user.id());
        Booking booking = Booking.initiate(BookingType.HOTEL, references.next(BookingType.HOTEL), user.id(),
                request.contact().email().strip().toLowerCase(Locale.ROOT), request.contact().phone().strip(), coupon,
                key, fingerprint(request));
        // Flushed first: the hotel part and the history reference the booking row.
        bookings.saveAndFlush(booking);
        HotelBooking hotel = hotelBookings.save(new HotelBooking(booking.getId(), request.quoteId(), guests,
                blankToNull(request.specialRequests())));
        lifecycle.created(booking, "Booking submitted");
        events.initiated(booking, hotel, lifecycle.now());
        log.info("Hotel booking submitted bookingId={} reference={} quoteId={}", booking.getId(),
                booking.getBookingReference(), request.quoteId());
        return new Submitted(booking.getId(), true);
    }

    /** After a duplicate-key race between two identical requests: the one that won. */
    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public Submitted repeated(CreateHotelBookingRequest request, String idempotencyKey) {
        Booking existing = findRepeat(CurrentUser.require().id(), requireKey(idempotencyKey), request);
        if (existing == null) {
            throw new IllegalStateException("Duplicate booking key without booking");
        }
        return new Submitted(existing.getId(), false);
    }

    private Booking findRepeat(UUID userId, String key, CreateHotelBookingRequest request) {
        return bookings.findByUserIdAndIdempotencyKey(userId, key).map(booking -> {
            if (!booking.getRequestHash().equals(fingerprint(request))) {
                throw new BusinessRuleException("IDEMPOTENCY_KEY_REUSED",
                        "This Idempotency-Key was already used for a different booking request.");
            }
            return booking;
        }).orElse(null);
    }

    private static String requireKey(String key) {
        if (key == null || key.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED",
                    "The Idempotency-Key header is required.");
        }
        if (!IDEMPOTENCY_KEY.matcher(key).matches()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY",
                    "The Idempotency-Key must be 8-100 letters, digits, '-' or '_'.");
        }
        return key;
    }

    /** One guest per room, rooms numbered 1..n without gaps (hotel-service checks n against the quote). */
    private static List<BookingGuest> guests(List<GuestName> names) {
        Set<Integer> rooms = new HashSet<>();
        for (GuestName name : names) {
            if (!rooms.add(name.roomNo()) || name.roomNo() > names.size()) {
                throw new BusinessRuleException("INVALID_GUESTS", "Enter one guest for each room (rooms 1 to "
                        + names.size() + ").", Map.of("field", "guests"));
            }
        }
        return names.stream()
                .sorted(Comparator.comparingInt(GuestName::roomNo))
                .map(name -> new BookingGuest(name.roomNo(), name.firstName().strip(), name.lastName().strip()))
                .toList();
    }

    /** SHA-256 over everything the customer sent, to recognise "same key, different request". */
    static String fingerprint(CreateHotelBookingRequest request) {
        StringBuilder text = new StringBuilder()
                .append(request.quoteId()).append('|')
                .append(request.contact().email().strip().toLowerCase(Locale.ROOT)).append('|')
                .append(request.contact().phone().strip()).append('|')
                .append(request.couponCode() == null ? "" : request.couponCode().strip().toUpperCase(Locale.ROOT))
                .append('|').append(request.specialRequests() == null ? "" : request.specialRequests().strip());
        request.guests().stream().sorted(Comparator.comparingInt(GuestName::roomNo)).forEach(guest -> text.append('|')
                .append(guest.roomNo()).append(':').append(guest.firstName().strip()).append(' ')
                .append(guest.lastName().strip()));
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(text.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    public record Submitted(UUID bookingId, boolean created) {
    }
}
