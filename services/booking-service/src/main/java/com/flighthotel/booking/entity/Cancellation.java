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
 * One cancellation request of a booking (BOOKING_WORKFLOW.md section 4). PENDING until the hotel or airline answers;
 * CONFIRMED with the final fee and refund, or REJECTED with the reason (the booking is then confirmed again). The quoted
 * fee is what the booked policy said at {@code requestedAt}: the customer is never charged for the time the hotel or
 * airline took to answer.
 */
@Getter
@Entity
@Table(name = "cancellations")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Cancellation {

    public static final String PENDING = "PENDING";
    public static final String CONFIRMED = "CONFIRMED";
    public static final String REJECTED = "REJECTED";

    @Id
    private UUID id;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(name = "initiated_by", nullable = false, updatable = false, length = 20)
    private String initiatedBy;

    @Column(name = "requested_by", nullable = false, updatable = false, length = 64)
    private String requestedBy;

    @Column(length = 500, updatable = false)
    private String reason;

    @Column(name = "fee_waived", nullable = false, updatable = false)
    private boolean feeWaived;

    @Column(nullable = false, length = 3, updatable = false)
    private String currency;

    @Column(name = "paid_amount", nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal paidAmount;

    @Column(name = "quoted_fee", nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal quotedFee;

    @Column(name = "quoted_refund", nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal quotedRefund;

    @Column(name = "cancellation_fee", precision = 12, scale = 2)
    private BigDecimal cancellationFee;

    @Column(name = "refund_amount", precision = 12, scale = 2)
    private BigDecimal refundAmount;

    @Column(name = "supplier_fee", precision = 12, scale = 2)
    private BigDecimal supplierFee;

    @Column(name = "supplier_reference", length = 30)
    private String supplierReference;

    @Column(name = "failure_reason", length = 40)
    private String failureReason;

    @Column(name = "failure_message", length = 255)
    private String failureMessage;

    @Column(name = "idempotency_key", nullable = false, updatable = false, length = 100)
    private String idempotencyKey;

    @Column(name = "request_hash", nullable = false, updatable = false, length = 64)
    private String requestHash;

    @Column(nullable = false)
    private int attempts;

    @Column(name = "last_sent_at", nullable = false)
    private Instant lastSentAt;

    @Column(name = "requested_at", nullable = false, updatable = false)
    private Instant requestedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Version
    private Long version;

    public record Request(UUID bookingId, String initiatedBy, String requestedBy, String reason, boolean feeWaived,
            String currency, BigDecimal paidAmount, BigDecimal quotedFee, BigDecimal quotedRefund,
            String idempotencyKey, String requestHash) {
    }

    public static Cancellation requested(Request request, Instant now) {
        Cancellation cancellation = new Cancellation();
        cancellation.id = UuidV7.generate();
        cancellation.bookingId = request.bookingId();
        cancellation.status = PENDING;
        cancellation.initiatedBy = request.initiatedBy();
        cancellation.requestedBy = request.requestedBy();
        cancellation.reason = request.reason();
        cancellation.feeWaived = request.feeWaived();
        cancellation.currency = request.currency();
        cancellation.paidAmount = request.paidAmount();
        cancellation.quotedFee = request.quotedFee();
        cancellation.quotedRefund = request.quotedRefund();
        cancellation.idempotencyKey = request.idempotencyKey();
        cancellation.requestHash = request.requestHash();
        cancellation.attempts = 1;
        cancellation.lastSentAt = now;
        cancellation.requestedAt = now;
        return cancellation;
    }

    public boolean isPending() {
        return PENDING.equals(status);
    }

    /** The hotel or airline confirmed: the final fee (the airline's own for flights) and what comes back. */
    public void confirmed(BigDecimal fee, BigDecimal refund, BigDecimal supplierFee, String supplierReference,
            Instant now) {
        this.status = CONFIRMED;
        this.cancellationFee = fee;
        this.refundAmount = refund;
        this.supplierFee = supplierFee;
        this.supplierReference = supplierReference;
        this.completedAt = now;
    }

    public void rejected(String reason, String message, Instant now) {
        this.status = REJECTED;
        this.failureReason = limit(reason, 40);
        this.failureMessage = limit(message, 255);
        this.completedAt = now;
    }

    /** Sent again by the reconciliation job (the hotel or airline repeats or gives its answer). */
    public void resent(Instant now) {
        this.attempts++;
        this.lastSentAt = now;
    }

    /** The fee shown to the customer: final once confirmed, the quote before. */
    public BigDecimal fee() {
        return cancellationFee != null ? cancellationFee : quotedFee;
    }

    public BigDecimal refund() {
        return refundAmount != null ? refundAmount : quotedRefund;
    }

    private static String limit(String text, int max) {
        return text == null || text.length() <= max ? text : text.substring(0, max);
    }
}
