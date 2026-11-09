package com.flighthotel.booking.entity;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import com.flighthotel.common.id.UuidV7;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * A coupon used by a booking: RESERVED when the price is fixed, CONSUMED when the booking is confirmed, RELEASED
 * (and the coupon's counter given back) when the booking fails, expires or is refunded before confirmation.
 */
@Getter
@Entity
@Table(name = "coupon_usage")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CouponUsage implements org.springframework.data.domain.Persistable<UUID> {

    public static final String RESERVED = "RESERVED";
    public static final String CONSUMED = "CONSUMED";
    public static final String RELEASED = "RELEASED";

    @Id
    private UUID id;

    @Column(name = "coupon_id", nullable = false, updatable = false)
    private UUID couponId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(name = "discount_amount", nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal discountAmount;

    @Column(nullable = false, length = 10)
    private String status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @jakarta.persistence.Transient
    private boolean isNew = true;

    public CouponUsage(UUID couponId, UUID userId, UUID bookingId, BigDecimal discountAmount, Instant now) {
        this.id = UuidV7.generate();
        this.couponId = couponId;
        this.userId = userId;
        this.bookingId = bookingId;
        this.discountAmount = discountAmount;
        this.status = RESERVED;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public boolean isReserved() {
        return RESERVED.equals(status);
    }

    public void consume(Instant now) {
        status = CONSUMED;
        updatedAt = now;
    }

    public void release(Instant now) {
        status = RELEASED;
        updatedAt = now;
    }

    @Override
    public boolean isNew() {
        return isNew;
    }

    @jakarta.persistence.PostLoad
    @jakarta.persistence.PostPersist
    void markNotNew() {
        this.isNew = false;
    }
}
