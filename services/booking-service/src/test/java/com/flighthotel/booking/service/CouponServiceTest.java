package com.flighthotel.booking.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.Coupon;
import com.flighthotel.booking.entity.CouponUsage;
import com.flighthotel.booking.repository.CouponRepository;
import com.flighthotel.booking.repository.CouponUsageRepository;
import com.flighthotel.booking.service.CouponService.Applied;
import com.flighthotel.common.error.BusinessRuleException;

/**
 * Coupon maths and rules (requirement section 15) without a database: percent and fixed discounts, caps, the
 * one-rupee minimum payment, validity windows, limits, and that an ineligible coupon never fails a booking.
 */
class CouponServiceTest {

    private static final Instant NOW = Instant.parse("2026-11-06T06:00:00Z");

    private final CouponRepository coupons = mock(CouponRepository.class);
    private final CouponUsageRepository usages = mock(CouponUsageRepository.class);
    private final CouponService service = new CouponService(coupons, usages, Clock.fixed(NOW, ZoneOffset.UTC));

    // ------------------------------------------------------------------ the discount

    @Test
    void percentDiscountsAreRoundedToThePaisaAndCapped() {
        Coupon tenPercent = coupon("SAVE10", Coupon.PERCENT, "10");
        assertThat(tenPercent.discountFor(new BigDecimal("2625.50"))).isEqualByComparingTo("262.55");

        Coupon odd = coupon("ODD", Coupon.PERCENT, "12.5");
        // 12.5 % of 99.99 = 12.49875 → 12.50
        assertThat(odd.discountFor(new BigDecimal("99.99"))).isEqualByComparingTo("12.50");

        tenPercent.setMaxDiscount(new BigDecimal("1500.00"));
        assertThat(tenPercent.discountFor(new BigDecimal("40000.00"))).isEqualByComparingTo("1500.00");
        assertThat(tenPercent.discountFor(new BigDecimal("9000.00"))).isEqualByComparingTo("900.00");
    }

    @Test
    void aFixedDiscountIsNeverMoreThanTheAmount() {
        Coupon flat = coupon("FLAT500", Coupon.FIXED, "500");
        assertThat(flat.discountFor(new BigDecimal("2000.00"))).isEqualByComparingTo("500.00");
        assertThat(flat.discountFor(new BigDecimal("300.00"))).isEqualByComparingTo("300.00");
    }

    @Test
    void aBookingAlwaysKeepsOneRupeeToPay() {
        Coupon everything = coupon("FREE", Coupon.FIXED, "5000");
        Booking booking = booking(BookingType.HOTEL, "FREE");
        when(coupons.lockByCode("FREE")).thenReturn(Optional.of(everything));

        Applied applied = service.apply(booking, new BigDecimal("3000.00"), "Goa");

        // Payment providers need a positive amount: 3 000 − 2 999 = 1.
        assertThat(applied.discount()).isEqualByComparingTo("2999.00");
        assertThat(applied.code()).isEqualTo("FREE");
        assertThat(applied.note()).isNull();
    }

    // ------------------------------------------------------------------ applying it to a held price

    @Test
    void anEligibleCouponReservesOneUse() {
        Coupon coupon = coupon("SAVE10", Coupon.PERCENT, "10");
        Booking booking = booking(BookingType.HOTEL, "SAVE10");
        when(coupons.lockByCode("SAVE10")).thenReturn(Optional.of(coupon));

        Applied applied = service.apply(booking, new BigDecimal("5000.00"), "Goa");

        assertThat(applied).isEqualTo(new Applied("SAVE10", new BigDecimal("500.00"), null));
        assertThat(coupon.getUsedCount()).isEqualTo(1);
        ArgumentCaptor<CouponUsage> usage = ArgumentCaptor.forClass(CouponUsage.class);
        verify(usages).save(usage.capture());
        assertThat(usage.getValue().getBookingId()).isEqualTo(booking.getId());
        assertThat(usage.getValue().getDiscountAmount()).isEqualByComparingTo("500.00");
        assertThat(usage.getValue().isReserved()).isTrue();
    }

    @Test
    void anIneligibleCouponIsSkippedWithANoteAndNeverFailsTheBooking() {
        Coupon expired = coupon("OLD", Coupon.PERCENT, "10");
        expired.setValidTo(NOW);   // valid until now, exclusive
        assertSkipped(expired, BookingType.HOTEL, "5000.00", "Goa",
                "Coupon OLD was not applied: This coupon has expired or is not active.");

        Coupon inactive = coupon("PAUSED", Coupon.PERCENT, "10");
        inactive.setStatus("INACTIVE");
        assertSkipped(inactive, BookingType.HOTEL, "5000.00", "Goa", "expired or is not active");

        Coupon flightsOnly = coupon("FLYNOW", Coupon.PERCENT, "10");
        flightsOnly.setAppliesTo("FLIGHT");
        assertSkipped(flightsOnly, BookingType.HOTEL, "5000.00", "Goa", "not valid for hotel bookings");

        Coupon bigSpenders = coupon("BIG", Coupon.FIXED, "1000");
        bigSpenders.setMinBookingAmount(new BigDecimal("10000.00"));
        assertSkipped(bigSpenders, BookingType.HOTEL, "9999.99", "Goa", "needs a booking of at least ₹10,000");

        Coupon goaOnly = coupon("GOA", Coupon.PERCENT, "10");
        goaOnly.setDestinationCity("Goa");
        assertSkipped(goaOnly, BookingType.HOTEL, "5000.00", "Jaipur", "only valid for trips to Goa");

        Coupon usedUp = coupon("LIMITED", Coupon.PERCENT, "10");
        usedUp.setUsageLimit(1);
        usedUp.used();
        assertSkipped(usedUp, BookingType.HOTEL, "5000.00", "Goa", "fully used");

        when(coupons.lockByCode("GONE")).thenReturn(Optional.empty());
        Applied gone = service.apply(booking(BookingType.HOTEL, "GONE"), new BigDecimal("5000.00"), "Goa");
        assertThat(gone.note()).isEqualTo("Coupon GONE was not applied: This coupon code does not exist.");

        verify(usages, never()).save(any());
    }

    @Test
    void eachCustomerUsesACouponOnlyAsOftenAsAllowed() {
        Coupon once = coupon("ONCE", Coupon.PERCENT, "10");
        when(usages.countByCouponIdAndUserIdAndStatusIn(any(), any(), anyCollection())).thenReturn(1L);
        assertSkipped(once, BookingType.HOTEL, "5000.00", "Goa", "already used this coupon");

        Coupon twice = coupon("TWICE", Coupon.PERCENT, "10");
        twice.setPerCustomerLimit(2);
        when(coupons.lockByCode("TWICE")).thenReturn(Optional.of(twice));
        assertThat(service.apply(booking(BookingType.HOTEL, "TWICE"), new BigDecimal("5000.00"), "Goa").note())
                .isNull();
        // Only reserved and consumed uses count (released ones do not).
        verify(usages, atLeastOnce()).countByCouponIdAndUserIdAndStatusIn(any(), any(),
                eq(List.of(CouponUsage.RESERVED, CouponUsage.CONSUMED)));
    }

    @Test
    void theDestinationIsComparedWithoutCaseOrSpaces() {
        Coupon goaOnly = coupon("GOA", Coupon.PERCENT, "10");
        goaOnly.setDestinationCity("Goa");
        when(coupons.lockByCode("GOA")).thenReturn(Optional.of(goaOnly));
        assertThat(service.apply(booking(BookingType.HOTEL, "GOA"), new BigDecimal("5000.00"), "  gOA ").discount())
                .isEqualByComparingTo("500.00");
    }

    @Test
    void withoutACodeNothingHappens() {
        assertThat(service.apply(booking(BookingType.HOTEL, null), new BigDecimal("5000.00"), "Goa"))
                .isEqualTo(Applied.NONE);
        verify(coupons, never()).lockByCode(any());
    }

    // ------------------------------------------------------------------ the check when a booking is submitted

    @Test
    void aSubmittedCodeIsNormalisedAndABadOneIsRefusedStraightAway() {
        Coupon coupon = coupon("SAVE10", Coupon.PERCENT, "10");
        when(coupons.findByCode("SAVE10")).thenReturn(Optional.of(coupon));
        UUID userId = UUID.randomUUID();

        assertThat(service.checkForNewBooking("  save10 ", BookingType.HOTEL, userId)).isEqualTo("SAVE10");
        assertThat(service.checkForNewBooking(null, BookingType.HOTEL, userId)).isNull();
        assertThat(service.checkForNewBooking("  ", BookingType.HOTEL, userId)).isNull();

        assertThatThrownBy(() -> service.checkForNewBooking("NOPE", BookingType.HOTEL, userId))
                .isInstanceOf(BusinessRuleException.class).hasFieldOrPropertyWithValue("code", "COUPON_NOT_FOUND");
        coupon.setAppliesTo("FLIGHT");
        assertThatThrownBy(() -> service.checkForNewBooking("SAVE10", BookingType.HOTEL, userId))
                .isInstanceOf(BusinessRuleException.class)
                .hasFieldOrPropertyWithValue("code", "COUPON_NOT_APPLICABLE");
        coupon.setAppliesTo(Coupon.ALL);
        coupon.setValidFrom(NOW.plusSeconds(1));   // not started yet
        assertThatThrownBy(() -> service.checkForNewBooking("SAVE10", BookingType.HOTEL, userId))
                .isInstanceOf(BusinessRuleException.class).hasFieldOrPropertyWithValue("code", "COUPON_EXPIRED");
    }

    @Test
    void aReleasedUseNeverTakesTheCountBelowZero() {
        Coupon coupon = coupon("SAVE10", Coupon.PERCENT, "10");
        coupon.usageReleased();
        assertThat(coupon.getUsedCount()).isZero();
        coupon.used();
        coupon.usageReleased();
        assertThat(coupon.getUsedCount()).isZero();
    }

    // ------------------------------------------------------------------ helpers

    private void assertSkipped(Coupon coupon, BookingType type, String amount, String city, String notePart) {
        when(coupons.lockByCode(coupon.getCode())).thenReturn(Optional.of(coupon));
        int usedBefore = coupon.getUsedCount();
        Applied applied = service.apply(booking(type, coupon.getCode()), new BigDecimal(amount), city);
        assertThat(applied.code()).isNull();
        assertThat(applied.discount()).isEqualByComparingTo("0");
        assertThat(applied.note()).startsWith("Coupon " + coupon.getCode() + " was not applied: ").contains(notePart);
        assertThat(coupon.getUsedCount()).isEqualTo(usedBefore);
    }

    /** Active, for every booking type, valid for a month around now. */
    private static Coupon coupon(String code, String type, String value) {
        Coupon coupon = new Coupon(code);
        coupon.setTitle(code);
        coupon.setDiscountType(type);
        coupon.setDiscountValue(new BigDecimal(value));
        coupon.setValidFrom(NOW.minus(15, ChronoUnit.DAYS));
        coupon.setValidTo(NOW.plus(15, ChronoUnit.DAYS));
        return coupon;
    }

    private static Booking booking(BookingType type, String couponCode) {
        return Booking.initiate(type, "HT-TEST0001", UUID.randomUUID(), "asha@example.com", "+91 98000 00000",
                couponCode, "key-" + UUID.randomUUID(), "hash");
    }
}
