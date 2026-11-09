package com.flighthotel.booking.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.FlightBooking;
import com.flighthotel.booking.entity.HotelBooking;
import com.flighthotel.booking.service.CancellationPolicy.Quote;

/**
 * The cancellation rules of BOOKING_WORKFLOW.md section 4 without a database: fees, the free period, the deadline,
 * goodwill refunds already given, waived fees and every reason a booking cannot be cancelled.
 */
class CancellationPolicyTest {

    private static final Instant CHECK_IN = Instant.parse("2026-12-10T08:30:00Z");       // 14:00 in India
    private static final Instant FREE_UNTIL = Instant.parse("2026-12-08T08:30:00Z");
    private static final Instant DEPARTURE = Instant.parse("2026-12-10T01:00:00Z");
    private static final Instant EARLY = Instant.parse("2026-12-01T10:00:00Z");

    private final CancellationPolicy policy = new CancellationPolicy(Duration.ofHours(4));

    // ------------------------------------------------------------------ hotels

    @Test
    void aStayCancelledInTheFreePeriodIsRefundedInFull() {
        Booking booking = confirmedHotel();
        Quote quote = policy.quote(booking, hotel(true, FREE_UNTIL, "25"), null, BigDecimal.ZERO, false, EARLY);

        assertThat(quote.cancellable()).isTrue();
        assertThat(quote.paidAmount()).isEqualByComparingTo("10700.00");
        assertThat(quote.cancellationFee()).isEqualByComparingTo("0");
        assertThat(quote.refundAmount()).isEqualByComparingTo("10700.00");
        assertThat(quote.freeCancellation()).isTrue();
        assertThat(quote.freeCancellationUntil()).isEqualTo(FREE_UNTIL);
        assertThat(quote.cancelUntil()).isEqualTo(CHECK_IN);
        assertThat(quote.feeDescription()).isEqualTo("No fee: you are within the free cancellation period");
    }

    @Test
    void fromTheEndOfTheFreePeriodTheFeeIsAShareOfTheStayPriceAndTheCouponDiscountIsNotGivenBack() {
        Booking booking = confirmedHotel();
        // Exactly at the end of the free period the fee applies.
        Quote quote = policy.quote(booking, hotel(true, FREE_UNTIL, "25"), null, BigDecimal.ZERO, false, FREE_UNTIL);

        // 25 % of the stay price (room charges 10 000 + GST 1 200, before the 500 coupon) = 2 800.
        assertThat(quote.cancellationFee()).isEqualByComparingTo("2800.00");
        // Paid 10 700 (after the coupon), so 7 900 comes back: the discount is not refunded on top.
        assertThat(quote.refundAmount()).isEqualByComparingTo("7900.00");
        assertThat(quote.freeCancellation()).isFalse();
        assertThat(quote.feeDescription()).isEqualTo("25% of the stay price (₹11,200)");
    }

    @Test
    void aNonRefundableStayKeepsEverythingAndItsFreePeriodIsIgnored() {
        Booking booking = confirmedHotel();
        Quote quote = policy.quote(booking, hotel(false, FREE_UNTIL, null), null, BigDecimal.ZERO, false, EARLY);

        // 100 % of 11 200, but never more than the 10 700 that was paid.
        assertThat(quote.cancellationFee()).isEqualByComparingTo("10700.00");
        assertThat(quote.refundAmount()).isEqualByComparingTo("0");
        assertThat(quote.freeCancellationUntil()).isNull();
        assertThat(quote.feeDescription()).isEqualTo("Non-refundable: 100% of the stay price (₹11,200)");
    }

    @Test
    void aZeroPercentFeeIsFreeAndAMissingFeeMeansNonRefundable() {
        Quote free = policy.quote(confirmedHotel(), hotel(true, null, "0"), null, BigDecimal.ZERO, false, EARLY);
        assertThat(free.cancellationFee()).isEqualByComparingTo("0");
        assertThat(free.freeCancellation()).isTrue();
        assertThat(free.feeDescription()).isEqualTo("No cancellation fee");

        // No hotel details at all (should not happen): the safe answer is the full fee, not a free cancellation.
        Quote unknown = policy.quote(confirmedHotel(), null, null, BigDecimal.ZERO, false, EARLY);
        assertThat(unknown.cancellationFee()).isEqualByComparingTo("10700.00");
        assertThat(unknown.refundAmount()).isEqualByComparingTo("0");
    }

    @Test
    void goodwillAlreadyRefundedIsSubtractedAndCapsTheFee() {
        HotelBooking hotel = hotel(true, FREE_UNTIL, "25");

        Quote some = policy.quote(confirmedHotel(), hotel, null, new BigDecimal("3000.00"), false, FREE_UNTIL);
        assertThat(some.paidAmount()).isEqualByComparingTo("7700.00");
        assertThat(some.cancellationFee()).isEqualByComparingTo("2800.00");
        assertThat(some.refundAmount()).isEqualByComparingTo("4900.00");

        // Less left than the fee: the fee takes what is left, nothing more.
        Quote most = policy.quote(confirmedHotel(), hotel, null, new BigDecimal("9000.00"), false, FREE_UNTIL);
        assertThat(most.paidAmount()).isEqualByComparingTo("1700.00");
        assertThat(most.cancellationFee()).isEqualByComparingTo("1700.00");
        assertThat(most.refundAmount()).isEqualByComparingTo("0");

        // Everything already given back: never a negative amount.
        Quote all = policy.quote(confirmedHotel(), hotel, null, new BigDecimal("12000.00"), false, FREE_UNTIL);
        assertThat(all.paidAmount()).isEqualByComparingTo("0");
        assertThat(all.cancellationFee()).isEqualByComparingTo("0");
        assertThat(all.refundAmount()).isEqualByComparingTo("0");
    }

    @Test
    void aWaivedFeeRefundsWhatIsStillPaid() {
        Quote quote = policy.quote(confirmedHotel(), hotel(false, null, null), null, new BigDecimal("700.00"), true,
                EARLY);

        assertThat(quote.feeWaived()).isTrue();
        assertThat(quote.cancellationFee()).isEqualByComparingTo("0");
        assertThat(quote.refundAmount()).isEqualByComparingTo("10000.00");
        assertThat(quote.feeDescription()).isEqualTo("Fee waived: the full amount is refunded");
    }

    // ------------------------------------------------------------------ flights

    @Test
    void aFlightKeepsAShareOfTheFareAndRefundsTaxesAndCharges() {
        Quote quote = policy.quote(confirmedFlight(), null, flight(30), BigDecimal.ZERO, false, EARLY);

        // 30 % of the 8 000 fare; the 1 500 taxes are always refunded.
        assertThat(quote.cancellationFee()).isEqualByComparingTo("2400.00");
        assertThat(quote.refundAmount()).isEqualByComparingTo("7100.00");
        assertThat(quote.feeDescription()).isEqualTo("30% of the fare (₹8,000); taxes and charges are refunded");
        assertThat(quote.cancelUntil()).isEqualTo(DEPARTURE.minus(Duration.ofHours(4)));
    }

    @Test
    void aNonRefundableFareKeepsTheFareOnly() {
        Quote quote = policy.quote(confirmedFlight(), null, flight(null), BigDecimal.ZERO, false, EARLY);

        assertThat(quote.cancellationFee()).isEqualByComparingTo("8000.00");
        assertThat(quote.refundAmount()).isEqualByComparingTo("1500.00");
        assertThat(quote.feeDescription())
                .isEqualTo("Non-refundable fare: the fare (₹8,000) is kept; taxes and charges are refunded");
    }

    @Test
    void feesAreRoundedHalfUpToThePaisa() {
        Booking booking = booking(BookingType.FLIGHT, "999.99", "100.00", "0", DEPARTURE.minus(Duration.ofHours(4)));
        moveTo(booking, BookingStatus.CONFIRMED);
        booking.paid(UUID.randomUUID());
        Quote quote = policy.quote(booking, null, flight(15), BigDecimal.ZERO, false, EARLY);

        // 15 % of 999.99 = 149.9985 → 150.00
        assertThat(quote.cancellationFee()).isEqualByComparingTo("150.00");
        assertThat(quote.refundAmount()).isEqualByComparingTo("949.99");
    }

    // ------------------------------------------------------------------ when a booking cannot be cancelled

    @Test
    void onlyAPaidConfirmedBookingBeforeItsDeadlineCanBeCancelled() {
        HotelBooking hotel = hotel(true, FREE_UNTIL, "25");

        Booking unpaid = booking(BookingType.HOTEL, "10000.00", "1200.00", "500.00", CHECK_IN);
        moveTo(unpaid, BookingStatus.CONFIRMED);
        assertNotCancellable(policy.quote(unpaid, hotel, null, BigDecimal.ZERO, false, EARLY),
                CancellationPolicy.NOT_CONFIRMED, "Only confirmed bookings can be cancelled.");

        Booking pending = booking(BookingType.HOTEL, "10000.00", "1200.00", "500.00", CHECK_IN);
        moveTo(pending, BookingStatus.PENDING_PAYMENT);
        assertNotCancellable(policy.quote(pending, hotel, null, BigDecimal.ZERO, false, EARLY),
                CancellationPolicy.NOT_CONFIRMED, "Only confirmed bookings can be cancelled.");

        // The deadline itself is too late.
        Booking stay = confirmedHotel();
        Quote atCheckIn = policy.quote(stay, hotel, null, BigDecimal.ZERO, false, CHECK_IN);
        assertNotCancellable(atCheckIn, CancellationPolicy.TOO_LATE, "The check-in time has passed");
        assertThat(CancellationPolicy.canCancel(stay, CHECK_IN.minusMillis(1))).isTrue();
        assertThat(CancellationPolicy.canCancel(stay, CHECK_IN)).isFalse();

        Booking flight = confirmedFlight();
        assertNotCancellable(policy.quote(flight, null, flight(30), BigDecimal.ZERO, false,
                DEPARTURE.minus(Duration.ofHours(3))), CancellationPolicy.TOO_LATE, "up to 4 hours before departure");
    }

    @Test
    void laterStatesSayWhyTheyCannotBeCancelledAgain() {
        HotelBooking hotel = hotel(true, FREE_UNTIL, "25");

        Booking inProgress = confirmedHotel();
        inProgress.moveTo(BookingStatus.CANCELLATION_PENDING);
        assertNotCancellable(policy.quote(inProgress, hotel, null, BigDecimal.ZERO, false, EARLY),
                CancellationPolicy.CANCELLATION_IN_PROGRESS, "already in progress");

        Booking cancelled = confirmedHotel();
        cancelled.moveTo(BookingStatus.CANCELLATION_PENDING);
        cancelled.moveTo(BookingStatus.CANCELLED);
        cancelled.cancelled(EARLY);
        assertNotCancellable(policy.quote(cancelled, hotel, null, BigDecimal.ZERO, false, EARLY),
                CancellationPolicy.ALREADY_CANCELLED, "already cancelled");
        // Its refund on the way: still "already cancelled".
        cancelled.moveTo(BookingStatus.REFUND_PENDING);
        assertNotCancellable(policy.quote(cancelled, hotel, null, BigDecimal.ZERO, false, EARLY),
                CancellationPolicy.ALREADY_CANCELLED, "already cancelled");

        // A refund of a booking that never got confirmed (paid after it expired): it was never a booking to cancel.
        Booking expired = booking(BookingType.HOTEL, "10000.00", "1200.00", "500.00", CHECK_IN);
        moveTo(expired, BookingStatus.PENDING_PAYMENT);
        expired.moveTo(BookingStatus.EXPIRED);
        expired.moveTo(BookingStatus.REFUND_PENDING);
        assertNotCancellable(policy.quote(expired, hotel, null, BigDecimal.ZERO, false, EARLY),
                CancellationPolicy.NOT_CONFIRMED, "Only confirmed bookings");

        Booking completed = confirmedHotel();
        completed.moveTo(BookingStatus.COMPLETED);
        assertNotCancellable(policy.quote(completed, hotel, null, BigDecimal.ZERO, false, EARLY),
                CancellationPolicy.COMPLETED, "already taken place");
    }

    // ------------------------------------------------------------------ deadlines

    @Test
    void deadlinesFallBackToIndiaTimeForOlderEvents() {
        assertThat(CancellationPolicy.hotelCancelUntil(CHECK_IN, LocalDate.of(2030, 1, 1), "12:00")).isEqualTo(CHECK_IN);
        // 14:00 in India = 08:30 UTC.
        assertThat(CancellationPolicy.hotelCancelUntil(null, LocalDate.of(2026, 12, 10), "14:00")).isEqualTo(CHECK_IN);

        assertThat(policy.flightCancelUntil(DEPARTURE, "2030-01-01T00:00")).isEqualTo(Instant.parse("2026-12-09T21:00:00Z"));
        // 06:30 in India = 01:00 UTC, minus the 4-hour cutoff.
        assertThat(policy.flightCancelUntil(null, "2026-12-10T06:30")).isEqualTo(Instant.parse("2026-12-09T21:00:00Z"));
        assertThat(new CancellationPolicy(Duration.ofHours(24)).flightCancelUntil(DEPARTURE, null))
                .isEqualTo(Instant.parse("2026-12-09T01:00:00Z"));
    }

    // ------------------------------------------------------------------ helpers

    private static void assertNotCancellable(Quote quote, String reason, String messagePart) {
        assertThat(quote.cancellable()).isFalse();
        assertThat(quote.reasonCode()).isEqualTo(reason);
        assertThat(quote.message()).contains(messagePart);
        assertThat(quote.cancellationFee()).isEqualByComparingTo("0");
        assertThat(quote.refundAmount()).isEqualByComparingTo("0");
    }

    /** Room charges 10 000 + GST 1 200 − coupon 500 = 10 700 paid, cancellable until check-in. */
    private static Booking confirmedHotel() {
        Booking booking = booking(BookingType.HOTEL, "10000.00", "1200.00", "500.00", CHECK_IN);
        moveTo(booking, BookingStatus.CONFIRMED);
        booking.paid(UUID.randomUUID());
        return booking;
    }

    /** Fare 8 000 + taxes 1 500 = 9 500 paid, cancellable until 4 hours before departure. */
    private static Booking confirmedFlight() {
        Booking booking = booking(BookingType.FLIGHT, "8000.00", "1500.00", "0", DEPARTURE.minus(Duration.ofHours(4)));
        moveTo(booking, BookingStatus.CONFIRMED);
        booking.paid(UUID.randomUUID());
        return booking;
    }

    private static Booking booking(BookingType type, String base, String tax, String discount, Instant cancelUntil) {
        Booking booking = Booking.initiate(type, "HT-TEST0001", UUID.randomUUID(), "asha@example.com",
                "+91 98000 00000", null, "key-" + UUID.randomUUID(), "hash");
        booking.inventoryHeld("Sea Breeze Resort", "Goa", LocalDate.of(2026, 12, 10), LocalDate.of(2026, 12, 12),
                EARLY.plus(Duration.ofMinutes(15)), EARLY.plus(Duration.ofMinutes(15)), "HOTEL", "policy text",
                cancelUntil, cancelUntil);
        booking.price(new BigDecimal(base), new BigDecimal(tax), new BigDecimal(discount), "INR", List.of());
        return booking;
    }

    /** Along the state machine's happy path up to {@code target}. */
    private static void moveTo(Booking booking, BookingStatus target) {
        for (BookingStatus step : List.of(BookingStatus.PENDING_PAYMENT, BookingStatus.PAYMENT_SUCCESS,
                BookingStatus.SUPPLIER_PENDING, BookingStatus.CONFIRMED)) {
            booking.moveTo(step);
            if (step == target) {
                return;
            }
        }
    }

    private static HotelBooking hotel(boolean refundable, Instant freeUntil, String feePercent) {
        HotelBooking hotel = new HotelBooking(UUID.randomUUID(), UUID.randomUUID(), List.of(), null);
        ReflectionTestUtils.setField(hotel, "refundable", refundable);
        ReflectionTestUtils.setField(hotel, "freeCancellationUntil", freeUntil);
        ReflectionTestUtils.setField(hotel, "cancellationFeePercent", feePercent == null ? null : new BigDecimal(feePercent));
        return hotel;
    }

    private static FlightBooking flight(Integer feePercent) {
        FlightBooking flight = new FlightBooking(UUID.randomUUID(), "offer-1", 1, 0, 0);
        ReflectionTestUtils.setField(flight, "refundable", feePercent != null);
        ReflectionTestUtils.setField(flight, "cancellationFeePercent", feePercent);
        return flight;
    }
}
