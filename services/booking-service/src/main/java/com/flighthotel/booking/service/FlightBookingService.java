package com.flighthotel.booking.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.Period;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.dto.BookingDtos.CreateFlightBookingRequest;
import com.flighthotel.booking.dto.BookingDtos.PassengerInput;
import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingPassenger;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.FlightBooking;
import com.flighthotel.booking.repository.BookingPassengerRepository;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.repository.FlightBookingRepository;
import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;

/**
 * Step 1 of the flight booking saga: record the customer's request ({@code INITIATED}) and ask flight-service to hold
 * the seats ({@code BookingInitiated}). Nothing is reserved or priced here; that is flight-service's answer. Idempotent
 * per customer and {@code Idempotency-Key}, like the hotel booking.
 */
@Service
public class FlightBookingService {

    private static final Logger log = LoggerFactory.getLogger(FlightBookingService.class);
    private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("^[A-Za-z0-9_-]{8,100}$");
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    private final BookingRepository bookings;
    private final FlightBookingRepository flightBookings;
    private final BookingPassengerRepository passengers;
    private final BookingReferences references;
    private final CouponService coupons;
    private final BookingLifecycle lifecycle;
    private final BookingEvents events;
    private final Clock clock;

    public FlightBookingService(BookingRepository bookings, FlightBookingRepository flightBookings,
            BookingPassengerRepository passengers, BookingReferences references, CouponService coupons,
            BookingLifecycle lifecycle, BookingEvents events, Clock clock) {
        this.bookings = bookings;
        this.flightBookings = flightBookings;
        this.passengers = passengers;
        this.references = references;
        this.coupons = coupons;
        this.lifecycle = lifecycle;
        this.events = events;
        this.clock = clock;
    }

    /** @return the booking and whether it was created now (false: the same request was sent before) */
    @PreAuthorize("isAuthenticated()")
    @Transactional
    public HotelBookingService.Submitted create(CreateFlightBookingRequest request, String idempotencyKey) {
        AuthenticatedUser user = CurrentUser.require();
        String key = requireKey(idempotencyKey);
        Booking existing = findRepeat(user.id(), key, request);
        if (existing != null) {
            return new HotelBookingService.Submitted(existing.getId(), false);
        }

        List<BookingPassenger.Details> details = validated(request.passengers());
        String coupon = coupons.checkForNewBooking(request.couponCode(), BookingType.FLIGHT, user.id());
        Booking booking = Booking.initiate(BookingType.FLIGHT, references.next(BookingType.FLIGHT), user.id(),
                request.contact().email().strip().toLowerCase(Locale.ROOT), request.contact().phone().strip(), coupon,
                key, fingerprint(request));
        bookings.saveAndFlush(booking);   // flushed first: the flight part, the passengers and the history reference it
        int adults = (int) details.stream().filter(d -> "ADULT".equals(d.type())).count();
        int children = (int) details.stream().filter(d -> "CHILD".equals(d.type())).count();
        int infants = details.size() - adults - children;
        flightBookings.save(new FlightBooking(booking.getId(), request.tripOfferId(), adults, children, infants));
        details.forEach(d -> passengers.save(new BookingPassenger(booking.getId(), d)));
        lifecycle.created(booking, "Booking submitted");
        events.initiatedFlight(booking, request.tripOfferId(), details, lifecycle.now());
        log.info("Flight booking submitted bookingId={} reference={} offerId={} travellers={}", booking.getId(),
                booking.getBookingReference(), request.tripOfferId(), details.size());
        return new HotelBookingService.Submitted(booking.getId(), true);
    }

    /** After a duplicate-key race between two identical requests: the one that won. */
    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public HotelBookingService.Submitted repeated(CreateFlightBookingRequest request, String idempotencyKey) {
        Booking existing = findRepeat(CurrentUser.require().id(), requireKey(idempotencyKey), request);
        if (existing == null) {
            throw new IllegalStateException("Duplicate booking key without booking");
        }
        return new HotelBookingService.Submitted(existing.getId(), false);
    }

    private Booking findRepeat(UUID userId, String key, CreateFlightBookingRequest request) {
        return bookings.findByUserIdAndIdempotencyKey(userId, key).map(booking -> {
            if (!booking.getRequestHash().equals(fingerprint(request))) {
                throw new BusinessRuleException("IDEMPOTENCY_KEY_REUSED",
                        "This Idempotency-Key was already used for a different booking request.");
            }
            return booking;
        }).orElse(null);
    }

    // ------------------------------------------------------------------ validation

    /**
     * Travellers must be adults first, then children, then infants; at least one adult, at most one infant per adult,
     * at most 9 with a seat. Ages are checked against today (the airline checks them at departure).
     */
    List<BookingPassenger.Details> validated(List<PassengerInput> input) {
        LocalDate today = LocalDate.now(clock.withZone(INDIA));
        int adults = 0;
        int children = 0;
        int infants = 0;
        int lastRank = 0;
        List<BookingPassenger.Details> result = new ArrayList<>();
        for (int i = 0; i < input.size(); i++) {
            PassengerInput p = input.get(i);
            int rank = switch (p.passengerType()) {
                case "ADULT" -> 1;
                case "CHILD" -> 2;
                default -> 3;
            };
            if (rank < lastRank) {
                throw invalid("List the adults first, then the children, then the infants.");
            }
            lastRank = rank;
            switch (p.passengerType()) {
                case "ADULT" -> adults++;
                case "CHILD" -> children++;
                default -> infants++;
            }
            checkAge(p, i + 1, today);
            checkPassport(p, i + 1, today);
            result.add(new BookingPassenger.Details(i + 1, p.passengerType(), p.firstName().strip(),
                    p.lastName().strip(), p.dateOfBirth(), blankToNull(p.gender()),
                    upperOrNull(p.nationality()), upperOrNull(p.passportNumber()), p.passportExpiry(),
                    upperOrNull(p.passportCountry())));
        }
        if (adults < 1 || infants > adults || adults + children > 9) {
            throw invalid("Book 1 to 9 travellers with a seat and at most one infant per adult.");
        }
        return result;
    }

    private static void checkAge(PassengerInput p, int number, LocalDate today) {
        if ("ADULT".equals(p.passengerType())) {
            if (p.dateOfBirth() != null && Period.between(p.dateOfBirth(), today).getYears() < 12) {
                throw invalid("Traveller " + number + " is under 12: choose Child or Infant.");
            }
            return;
        }
        if (p.dateOfBirth() == null) {
            throw invalid("Enter the date of birth of traveller " + number + " (" + p.passengerType().toLowerCase()
                    + ").");
        }
        if (p.dateOfBirth().isAfter(today)) {
            throw invalid("The date of birth of traveller " + number + " is in the future.");
        }
        int age = Period.between(p.dateOfBirth(), today).getYears();
        if ("CHILD".equals(p.passengerType()) && (age < 2 || age > 11)) {
            throw invalid("A child is 2 to 11 years old (traveller " + number + ").");
        }
        if ("INFANT".equals(p.passengerType()) && age >= 2) {
            throw invalid("An infant is under 2 years old (traveller " + number + ").");
        }
    }

    private static void checkPassport(PassengerInput p, int number, LocalDate today) {
        boolean any = notBlank(p.passportNumber()) || p.passportExpiry() != null || notBlank(p.passportCountry());
        if (!any) {
            return;
        }
        if (!notBlank(p.passportNumber()) || p.passportExpiry() == null || !notBlank(p.passportCountry())) {
            throw invalid("Enter the passport number, expiry and country of traveller " + number + ", or none of them.");
        }
        if (!p.passportExpiry().isAfter(today)) {
            throw invalid("The passport of traveller " + number + " has expired.");
        }
    }

    private static boolean notBlank(String value) {
        return value != null && !value.isBlank();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static String upperOrNull(String value) {
        return value == null || value.isBlank() ? null : value.strip().toUpperCase(Locale.ROOT);
    }

    private static BusinessRuleException invalid(String message) {
        return new BusinessRuleException("INVALID_PASSENGERS", message, Map.of("field", "passengers"));
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

    /** SHA-256 over everything the customer sent, to recognise "same key, different request". */
    static String fingerprint(CreateFlightBookingRequest request) {
        StringBuilder text = new StringBuilder()
                .append(request.tripOfferId()).append('|')
                .append(request.contact().email().strip().toLowerCase(Locale.ROOT)).append('|')
                .append(request.contact().phone().strip()).append('|')
                .append(request.couponCode() == null ? "" : request.couponCode().strip().toUpperCase(Locale.ROOT));
        for (PassengerInput p : request.passengers()) {
            text.append('|').append(p.passengerType()).append(':').append(p.firstName().strip()).append(' ')
                    .append(p.lastName().strip()).append(':').append(p.dateOfBirth()).append(':').append(p.gender())
                    .append(':').append(p.nationality()).append(':').append(p.passportNumber()).append(':')
                    .append(p.passportExpiry()).append(':').append(p.passportCountry());
        }
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(text.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
