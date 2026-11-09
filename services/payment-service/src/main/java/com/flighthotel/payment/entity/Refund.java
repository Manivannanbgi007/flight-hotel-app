package com.flighthotel.payment.entity;

import java.math.BigDecimal;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** Money given back to the customer. {@code idempotencyKey} is the refund request id of booking-service. */
@Getter
@Entity
@Table(name = "refunds")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Refund extends AuditableEntity {

    public enum Status { PENDING, PROCESSED, FAILED }

    @Id
    private UUID id;

    @Column(name = "payment_id", nullable = false, updatable = false)
    private UUID paymentId;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal amount;

    @Column(nullable = false, length = 3, updatable = false)
    private String currency;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 20)
    private Status status;

    @Column(name = "provider_refund_id", length = 64)
    private String providerRefundId;

    @Column(nullable = false, updatable = false, length = 30)
    private String reason;

    @Column(name = "failure_reason", length = 255)
    private String failureReason;

    @Column(name = "idempotency_key", nullable = false, updatable = false, length = 64)
    private String idempotencyKey;

    @Version
    private Long version;

    public Refund(PaymentTransaction payment, BigDecimal amount, String reason, String idempotencyKey) {
        this.id = UuidV7.generate();
        this.paymentId = payment.getId();
        this.bookingId = payment.getBookingId();
        this.userId = payment.getUserId();
        this.amount = amount;
        this.currency = payment.getCurrency();
        this.reason = reason.length() > 30 ? reason.substring(0, 30) : reason;
        this.idempotencyKey = idempotencyKey;
        this.status = Status.PENDING;
    }

    public void sentToProvider(String providerRefundId) {
        this.providerRefundId = providerRefundId;
    }

    public void processed() {
        this.status = Status.PROCESSED;
        this.failureReason = null;
    }

    public void failed(String reason) {
        this.status = Status.FAILED;
        this.failureReason = reason == null ? null : reason.substring(0, Math.min(255, reason.length()));
    }

    public boolean isPending() {
        return status == Status.PENDING;
    }
}
