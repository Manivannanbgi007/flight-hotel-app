package com.flighthotel.booking.entity;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.UuidGenerator;

import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A discount code (requirement §15). The discount is always calculated here, on the backend, from the price
 * hotel-service held; the browser only sends the code.
 */
@Getter
@Setter
@Entity
@Table(name = "coupons")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Coupon extends AuditableEntity {

    public static final String PERCENT = "PERCENT";
    public static final String FIXED = "FIXED";
    public static final String ALL = "ALL";

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Setter(AccessLevel.NONE)
    private UUID id;

    @Column(nullable = false, length = 30, updatable = false)
    private String code;

    @Column(nullable = false, length = 100)
    private String title;

    @Column(length = 500)
    private String description;

    @Column(name = "discount_type", nullable = false, length = 10)
    private String discountType;

    @Column(name = "discount_value", nullable = false, precision = 12, scale = 2)
    private BigDecimal discountValue;

    @Column(name = "max_discount", precision = 12, scale = 2)
    private BigDecimal maxDiscount;

    @Column(name = "min_booking_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal minBookingAmount = BigDecimal.ZERO;

    @Column(name = "applies_to", nullable = false, length = 10)
    private String appliesTo = ALL;

    @Column(name = "destination_city", length = 100)
    private String destinationCity;

    @Column(name = "valid_from", nullable = false)
    private Instant validFrom;

    @Column(name = "valid_to", nullable = false)
    private Instant validTo;

    @Column(name = "usage_limit")
    private Integer usageLimit;

    @Column(name = "per_customer_limit", nullable = false)
    private int perCustomerLimit = 1;

    @Column(name = "used_count", nullable = false)
    @Setter(AccessLevel.NONE)
    private int usedCount;

    @Column(nullable = false, length = 10)
    private String status = "ACTIVE";

    @Column(nullable = false)
    private boolean demo;

    @Version
    @Setter(AccessLevel.NONE)
    private Long version;

    public Coupon(String code) {
        this.code = code.toUpperCase(java.util.Locale.ROOT);
    }

    public boolean isActive() {
        return "ACTIVE".equals(status);
    }

    public boolean isValidAt(Instant now) {
        return !now.isBefore(validFrom) && now.isBefore(validTo);
    }

    public boolean appliesTo(BookingType type) {
        return ALL.equals(appliesTo) || appliesTo.equals(type.name());
    }

    public boolean usageLimitReached() {
        return usageLimit != null && usedCount >= usageLimit;
    }

    /** The discount for this amount: percent (capped) or fixed, never more than the amount. */
    public BigDecimal discountFor(BigDecimal amount) {
        BigDecimal discount = PERCENT.equals(discountType)
                ? amount.multiply(discountValue).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP)
                : discountValue;
        if (maxDiscount != null && discount.compareTo(maxDiscount) > 0) {
            discount = maxDiscount;
        }
        return discount.min(amount).setScale(2, RoundingMode.HALF_UP);
    }

    public void used() {
        usedCount++;
    }

    public void usageReleased() {
        usedCount = Math.max(0, usedCount - 1);
    }
}
