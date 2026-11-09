package com.flighthotel.payment.entity;

import java.math.BigDecimal;
import java.time.Instant;
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

/**
 * One payment attempt. Moves only forward: INITIATED to PENDING to SUCCESS or FAILED; a paid one may be refunded.
 * Never holds card, UPI or bank details.
 */
@Getter
@Entity
@Table(name = "payment_transactions")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PaymentTransaction extends AuditableEntity {

    @Id
    private UUID id;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(nullable = false, updatable = false, length = 10)
    private String provider;

    @Column(name = "provider_order_id", nullable = false, updatable = false, length = 64)
    private String providerOrderId;

    @Column(name = "provider_payment_id", length = 64)
    private String providerPaymentId;

    @Column(nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal amount;

    @Column(name = "refunded_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal refundedAmount = BigDecimal.ZERO;

    @Column(nullable = false, length = 3, updatable = false)
    private String currency;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 20)
    private PaymentStatus status;

    @Column(length = 20)
    private String method;

    @Column(name = "failure_code", length = 40)
    private String failureCode;

    @Column(name = "failure_message", length = 255)
    private String failureMessage;

    @Column(name = "idempotency_key", nullable = false, updatable = false, length = 100)
    private String idempotencyKey;

    @Column(name = "verified_at")
    private Instant verifiedAt;

    @Version
    private Long version;

    public PaymentTransaction(UUID bookingId, UUID userId, String provider, String providerOrderId, BigDecimal amount,
            String currency, String idempotencyKey) {
        this.id = UuidV7.generate();
        this.bookingId = bookingId;
        this.userId = userId;
        this.provider = provider;
        this.providerOrderId = providerOrderId;
        this.amount = amount;
        this.currency = currency;
        this.idempotencyKey = idempotencyKey;
        this.status = PaymentStatus.INITIATED;
    }

    /** The customer submitted a payment; the provider has not said captured or failed yet. */
    public void pending(String providerPaymentId, String method) {
        if (status.isOpen()) {
            this.providerPaymentId = providerPaymentId;
            this.method = limit(method, 20);
            this.status = PaymentStatus.PENDING;
        }
    }

    /** Verified captured money. */
    public void succeeded(String providerPaymentId, String method, Instant now) {
        this.providerPaymentId = providerPaymentId;
        this.method = limit(method, 20);
        this.failureCode = null;
        this.failureMessage = null;
        this.verifiedAt = now;
        this.status = PaymentStatus.SUCCESS;
    }

    public void failed(String providerPaymentId, String code, String message) {
        if (providerPaymentId != null) {
            this.providerPaymentId = providerPaymentId;
        }
        this.failureCode = limit(code == null ? "PAYMENT_FAILED" : code, 40);
        this.failureMessage = limit(message, 255);
        this.status = PaymentStatus.FAILED;
    }

    /** Something is wrong that a person must look at (e.g. captured amount differs); the status stays open. */
    public void flag(String code, String message) {
        this.failureCode = limit(code, 40);
        this.failureMessage = limit(message, 255);
    }

    public BigDecimal refundable() {
        return amount.subtract(refundedAmount);
    }

    public void refundStarted() {
        if (status == PaymentStatus.SUCCESS || status == PaymentStatus.PARTIALLY_REFUNDED) {
            this.status = PaymentStatus.REFUND_PENDING;
        }
    }

    /** A refund finished: the status shows whether everything or only a part came back. */
    public void refundProcessed(BigDecimal refunded) {
        this.refundedAmount = refundedAmount.add(refunded);
        this.status = refundedAmount.compareTo(this.amount) >= 0 ? PaymentStatus.REFUNDED
                : PaymentStatus.PARTIALLY_REFUNDED;
    }

    /** A refund was refused or could not be done: back to the paid state it came from. */
    public void refundAborted() {
        if (status == PaymentStatus.REFUND_PENDING) {
            this.status = refundedAmount.signum() > 0 ? PaymentStatus.PARTIALLY_REFUNDED : PaymentStatus.SUCCESS;
        }
    }

    private static String limit(String text, int max) {
        return text == null || text.length() <= max ? text : text.substring(0, max);
    }
}
