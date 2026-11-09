package com.flighthotel.booking.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.dto.BookingDtos.CouponCheckRequest;
import com.flighthotel.booking.dto.BookingDtos.CouponCheckResponse;
import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.Coupon;
import com.flighthotel.booking.entity.CouponUsage;
import com.flighthotel.booking.repository.CouponRepository;
import com.flighthotel.booking.repository.CouponUsageRepository;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.security.CurrentUser;

/**
 * Coupon rules (requirement §15), always evaluated on the backend:
 * <ul>
 *   <li>When a booking is submitted, the rules that do not depend on the price (code exists, active, dates, booking
 *       type, usage limits) are checked, and a bad code is refused straight away ({@code 422 COUPON_*}).</li>
 *   <li>When hotel-service has held the rooms and fixed the price, everything is checked again under a lock on the
 *       coupon (minimum amount, destination, limits) and one use is reserved. If the coupon no longer applies, the
 *       booking goes on without it and {@code couponNote} tells the customer why before they pay.</li>
 * </ul>
 */
@Service
public class CouponService {

    private static final List<String> COUNTED = List.of(CouponUsage.RESERVED, CouponUsage.CONSUMED);
    private static final BigDecimal MIN_PAYABLE = new BigDecimal("1.00");

    private final CouponRepository coupons;
    private final CouponUsageRepository usages;
    private final Clock clock;

    public CouponService(CouponRepository coupons, CouponUsageRepository usages, Clock clock) {
        this.coupons = coupons;
        this.usages = usages;
        this.clock = clock;
    }

    /** @return the normalized code, or null when none was given; throws {@code 422 COUPON_*} for a bad code */
    @Transactional(readOnly = true)
    public String checkForNewBooking(String code, BookingType type, UUID userId) {
        if (code == null || code.isBlank()) {
            return null;
        }
        String normalized = normalize(code);
        Coupon coupon = coupons.findByCode(normalized).orElseThrow(CouponService::notFound);
        checkWithoutPrice(coupon, type, userId, clock.instant());
        return normalized;
    }

    /** The discount the customer would get for this amount (advisory: the booking uses the price hotel-service holds). */
    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public CouponCheckResponse preview(CouponCheckRequest request) {
        UUID userId = CurrentUser.require().id();
        Coupon coupon = coupons.findByCode(normalize(request.code())).orElseThrow(CouponService::notFound);
        checkWithoutPrice(coupon, request.bookingType(), userId, clock.instant());
        checkPrice(coupon, request.amount(), request.destinationCity());
        BigDecimal discount = payableDiscount(coupon, request.amount());
        return new CouponCheckResponse(coupon.getCode(), coupon.getTitle(), coupon.getDescription(), discount,
                request.amount().subtract(discount), "INR");
    }

    /**
     * Applies the booking's coupon to the price that was just held and reserves one use. Never fails the booking: an
     * ineligible coupon gives no discount and a note.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Applied apply(Booking booking, BigDecimal amount, String destinationCity) {
        if (booking.getCouponCode() == null) {
            return Applied.NONE;
        }
        Coupon coupon = coupons.lockByCode(booking.getCouponCode()).orElse(null);
        try {
            if (coupon == null) {
                throw notFound();
            }
            checkWithoutPrice(coupon, booking.getBookingType(), booking.getUserId(), clock.instant());
            checkPrice(coupon, amount, destinationCity);
        } catch (BusinessRuleException notEligible) {
            return new Applied(null, BigDecimal.ZERO, "Coupon " + booking.getCouponCode() + " was not applied: "
                    + notEligible.getMessage());
        }
        BigDecimal discount = payableDiscount(coupon, amount);
        coupon.used();
        usages.save(new CouponUsage(coupon.getId(), booking.getUserId(), booking.getId(), discount, clock.instant()));
        return new Applied(coupon.getCode(), discount, null);
    }

    /** The booking was confirmed: the reserved use counts for good. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void consume(UUID bookingId) {
        usages.findByBookingId(bookingId).filter(CouponUsage::isReserved)
                .ifPresent(usage -> usage.consume(clock.instant()));
    }

    /** The booking did not happen: the customer may use the coupon again. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void release(UUID bookingId) {
        usages.findByBookingId(bookingId).filter(CouponUsage::isReserved).ifPresent(usage -> {
            usage.release(clock.instant());
            coupons.lockById(usage.getCouponId()).ifPresent(Coupon::usageReleased);
        });
    }

    private void checkWithoutPrice(Coupon coupon, BookingType type, UUID userId, Instant now) {
        if (!coupon.isActive() || !coupon.isValidAt(now)) {
            throw new BusinessRuleException("COUPON_EXPIRED", "This coupon has expired or is not active.");
        }
        if (!coupon.appliesTo(type)) {
            throw new BusinessRuleException("COUPON_NOT_APPLICABLE",
                    "This coupon is not valid for " + type.name().toLowerCase(Locale.ROOT) + " bookings.");
        }
        if (coupon.usageLimitReached()) {
            throw new BusinessRuleException("COUPON_USAGE_LIMIT_REACHED", "This coupon has been fully used.");
        }
        if (usages.countByCouponIdAndUserIdAndStatusIn(coupon.getId(), userId, COUNTED) >= coupon.getPerCustomerLimit()) {
            throw new BusinessRuleException("COUPON_ALREADY_USED", "You have already used this coupon.");
        }
    }

    private static void checkPrice(Coupon coupon, BigDecimal amount, String destinationCity) {
        if (amount.compareTo(coupon.getMinBookingAmount()) < 0) {
            throw new BusinessRuleException("COUPON_MIN_AMOUNT_NOT_MET", "This coupon needs a booking of at least "
                    + Amounts.format(coupon.getMinBookingAmount(), "INR") + ".",
                    Map.of("minBookingAmount", coupon.getMinBookingAmount()));
        }
        if (coupon.getDestinationCity() != null
                && (destinationCity == null || !coupon.getDestinationCity().equalsIgnoreCase(destinationCity.strip()))) {
            throw new BusinessRuleException("COUPON_NOT_APPLICABLE",
                    "This coupon is only valid for trips to " + coupon.getDestinationCity() + ".");
        }
    }

    /** Never discount everything: payment providers need a positive amount. */
    private static BigDecimal payableDiscount(Coupon coupon, BigDecimal amount) {
        BigDecimal discount = coupon.discountFor(amount);
        BigDecimal maxDiscount = amount.subtract(MIN_PAYABLE).max(BigDecimal.ZERO);
        return discount.min(maxDiscount);
    }

    private static String normalize(String code) {
        return code.strip().toUpperCase(Locale.ROOT);
    }

    private static BusinessRuleException notFound() {
        return new BusinessRuleException("COUPON_NOT_FOUND", "This coupon code does not exist.");
    }

    /** @param note why the coupon was not applied (null if it was, or if there was none) */
    public record Applied(String code, BigDecimal discount, String note) {

        static final Applied NONE = new Applied(null, BigDecimal.ZERO, null);
    }
}
