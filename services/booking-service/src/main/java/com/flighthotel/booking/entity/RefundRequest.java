package com.flighthotel.booking.entity;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import com.flighthotel.common.id.UuidV7;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * Money booking-service asked payment-service to give back. Its id travels as {@code refundRequestId} and is
 * payment-service's idempotency key, so one request is refunded at most once.
 */
@Getter
@Entity
@Table(name = "booking_refund_requests")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RefundRequest {

    public static final String BOOKING_FAILED = "BOOKING_FAILED";
    public static final String LATE_PAYMENT = "LATE_PAYMENT";
    public static final String DUPLICATE_PAYMENT = "DUPLICATE_PAYMENT";
    public static final String CANCELLATION = "CANCELLATION";
    /** Money given back by an admin while the booking stands (API_DOCUMENTATION.md section 14.2). */
    public static final String GOODWILL = "GOODWILL";
    public static final String REQUESTED = "REQUESTED";
    public static final String COMPLETED = "COMPLETED";
    public static final String FAILED = "FAILED";

    @Id
    private UUID id;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(name = "payment_id", nullable = false, updatable = false)
    private UUID paymentId;

    @Column(name = "cancellation_id", updatable = false)
    private UUID cancellationId;

    @Column(nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal amount;

    @Column(nullable = false, length = 3, updatable = false)
    private String currency;

    @Column(nullable = false, length = 30, updatable = false)
    private String reason;

    @Column(name = "idempotency_key", length = 100, updatable = false)
    private String idempotencyKey;

    @Column(name = "request_hash", length = 64, updatable = false)
    private String requestHash;

    @Column(name = "requested_by", length = 64, updatable = false)
    private String requestedBy;

    @Column(length = 500, updatable = false)
    private String note;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(name = "failure_reason", length = 255)
    private String failureReason;

    @Column(name = "requested_at", nullable = false, updatable = false)
    private Instant requestedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(nullable = false)
    private int attempts;

    @Column(name = "last_sent_at")
    private Instant lastSentAt;

    @Version
    private Long version;

    public RefundRequest(UUID bookingId, UUID paymentId, BigDecimal amount, String currency, String reason,
            Instant requestedAt) {
        this(bookingId, paymentId, null, amount, currency, reason, requestedAt);
    }

    public RefundRequest(UUID bookingId, UUID paymentId, UUID cancellationId, BigDecimal amount, String currency,
            String reason, Instant requestedAt) {
        this.id = UuidV7.generate();
        this.bookingId = bookingId;
        this.paymentId = paymentId;
        this.cancellationId = cancellationId;
        this.amount = amount;
        this.currency = currency;
        this.reason = reason;
        this.status = REQUESTED;
        this.requestedAt = requestedAt;
        this.attempts = 1;
        this.lastSentAt = requestedAt;
    }

    /** A goodwill refund: who asked, why, and the admin's Idempotency-Key. */
    public static RefundRequest goodwill(UUID bookingId, UUID paymentId, BigDecimal amount, String currency,
            String note, String requestedBy, String idempotencyKey, String requestHash, Instant requestedAt) {
        RefundRequest refund = new RefundRequest(bookingId, paymentId, null, amount, currency, GOODWILL, requestedAt);
        refund.note = note;
        refund.requestedBy = requestedBy;
        refund.idempotencyKey = idempotencyKey;
        refund.requestHash = requestHash;
        return refund;
    }

    public boolean isGoodwill() {
        return GOODWILL.equals(reason);
    }

    public boolean isRequested() {
        return REQUESTED.equals(status);
    }

    /** Sent again by the reconciliation job (payment-service repeats its answer or finishes the refund). */
    public void resent(Instant now) {
        this.attempts++;
        this.lastSentAt = now;
    }

    /** A refund of the whole booking (not of an extra, duplicate payment). */
    public boolean refundsTheBooking() {
        return !DUPLICATE_PAYMENT.equals(reason);
    }

    public void completed(Instant at) {
        status = COMPLETED;
        completedAt = at;
    }

    public void failed(String why) {
        status = FAILED;
        failureReason = why == null || why.length() <= 255 ? why : why.substring(0, 255);
    }
}
