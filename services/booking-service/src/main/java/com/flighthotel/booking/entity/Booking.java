package com.flighthotel.booking.entity;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * A customer's booking (any type). The type-specific part lives in {@link HotelBooking} (flights: Phase 6).
 * <p>
 * The status only changes through {@link #moveTo}, which enforces the state machine; {@code BookingLifecycle}
 * records every change in the history. Prices are only ever set from hotel-service's {@code HotelInventoryHeld}.
 */
@Getter
@Entity
@Table(name = "bookings")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Booking extends AuditableEntity {

    @Id
    private UUID id;

    @Column(name = "booking_reference", nullable = false, updatable = false, length = 12)
    private String bookingReference;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "booking_type", nullable = false, updatable = false, length = 10)
    private BookingType bookingType;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 25)
    private BookingStatus status;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "payment_status", nullable = false, length = 20)
    private PaymentStatus paymentStatus;

    @Column(length = 200)
    private String title;

    @Column(length = 100)
    private String destination;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "end_date")
    private LocalDate endDate;

    @Column(nullable = false, length = 3)
    private String currency = "INR";

    @Column(name = "base_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal baseAmount = BigDecimal.ZERO;

    @Column(name = "tax_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal taxAmount = BigDecimal.ZERO;

    @Column(name = "fee_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal feeAmount = BigDecimal.ZERO;

    @Column(name = "discount_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal discountAmount = BigDecimal.ZERO;

    @Column(name = "total_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal totalAmount = BigDecimal.ZERO;

    @Column(name = "refunded_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal refundedAmount = BigDecimal.ZERO;

    @Column(name = "coupon_code", length = 30, updatable = false)
    private String couponCode;

    @Column(name = "coupon_note", length = 255)
    private String couponNote;

    @Column(name = "contact_email", nullable = false, length = 254, updatable = false)
    private String contactEmail;

    @Column(name = "contact_phone", nullable = false, length = 20, updatable = false)
    private String contactPhone;

    @Column(name = "hold_expires_at")
    private Instant holdExpiresAt;

    @Column(name = "payment_deadline")
    private Instant paymentDeadline;

    @Column(name = "cancel_until")
    private Instant cancelUntil;

    @Column(name = "starts_at")
    private Instant startsAt;

    @Column(name = "paid_payment_id")
    private UUID paidPaymentId;

    @Column(name = "inventory_source", length = 20)
    private String inventorySource;

    @Column(name = "cancellation_policy_snapshot", columnDefinition = "TEXT")
    private String cancellationPolicySnapshot;

    @Column(name = "failure_reason", length = 40)
    private String failureReason;

    @Column(name = "failure_message", length = 255)
    private String failureMessage;

    @Column(name = "idempotency_key", nullable = false, updatable = false, length = 100)
    private String idempotencyKey;

    @Column(name = "request_hash", nullable = false, updatable = false, length = 64)
    private String requestHash;

    @Column(name = "confirmed_at")
    private Instant confirmedAt;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Column(name = "attention_reason", length = 30)
    private String attentionReason;

    @Column(name = "attention_note", length = 500)
    private String attentionNote;

    @Column(name = "attention_since")
    private Instant attentionSince;

    @ElementCollection
    @CollectionTable(name = "booking_price_items", joinColumns = @JoinColumn(name = "booking_id"))
    @OrderColumn(name = "line_no")
    private List<PriceItem> priceItems = new ArrayList<>();

    @Version
    private Long version;

    public static Booking initiate(BookingType type, String reference, UUID userId, String contactEmail,
            String contactPhone, String couponCode, String idempotencyKey, String requestHash) {
        Booking booking = new Booking();
        booking.id = UuidV7.generate();
        booking.bookingType = type;
        booking.bookingReference = reference;
        booking.userId = userId;
        booking.contactEmail = contactEmail;
        booking.contactPhone = contactPhone;
        booking.couponCode = couponCode;
        booking.idempotencyKey = idempotencyKey;
        booking.requestHash = requestHash;
        booking.status = BookingStatus.INITIATED;
        booking.paymentStatus = PaymentStatus.UNPAID;
        return booking;
    }

    /** Moves along the state machine; returns the previous status. */
    public BookingStatus moveTo(BookingStatus next) {
        if (!status.canMoveTo(next)) {
            throw new IllegalStateException("Booking " + bookingReference + " cannot move from " + status + " to "
                    + next);
        }
        BookingStatus previous = status;
        status = next;
        return previous;
    }

    /** What the inventory owner holds for the customer, for lists, the payment and the cancellation deadline. */
    public void inventoryHeld(String title, String destination, LocalDate startDate, LocalDate endDate,
            Instant holdExpiresAt, Instant paymentDeadline, String inventorySource, String cancellationPolicy,
            Instant startsAt, Instant cancelUntil) {
        this.startsAt = startsAt;
        this.cancelUntil = cancelUntil;
        this.title = title;
        this.destination = destination;
        this.startDate = startDate;
        this.endDate = endDate;
        this.holdExpiresAt = holdExpiresAt;
        this.paymentDeadline = paymentDeadline;
        this.inventorySource = inventorySource;
        this.cancellationPolicySnapshot = cancellationPolicy;
    }

    /** The final price (from the inventory owner) and its breakdown. */
    public void price(BigDecimal base, BigDecimal tax, BigDecimal discount, String currency, List<PriceItem> items) {
        this.baseAmount = base;
        this.taxAmount = tax;
        this.feeAmount = BigDecimal.ZERO;
        this.discountAmount = discount;
        this.totalAmount = base.add(tax).subtract(discount);
        this.currency = currency;
        this.priceItems.clear();
        this.priceItems.addAll(items);
    }

    public void couponNotApplied(String note) {
        this.couponNote = note;
    }

    public void failed(String reason, String message, String knownTitle) {
        this.failureReason = reason;
        this.failureMessage = message;
        if (title == null) {
            this.title = knownTitle;
        }
    }

    public void paymentFailed() {
        if (paymentStatus == PaymentStatus.UNPAID || paymentStatus == PaymentStatus.PAYMENT_FAILED) {
            paymentStatus = PaymentStatus.PAYMENT_FAILED;
        }
    }

    public void paid(UUID paymentId) {
        this.paidPaymentId = paymentId;
        this.paymentStatus = PaymentStatus.PAID;
    }

    public void refundPending() {
        this.paymentStatus = PaymentStatus.REFUND_PENDING;
    }

    /** A refund of the booking's money completed: all of it back, or only part (a cancellation fee was kept). */
    public void refundCompleted(BigDecimal amount) {
        this.refundedAmount = refundedAmount.add(amount);
        this.paymentStatus = refundedAmount.compareTo(totalAmount) >= 0 ? PaymentStatus.REFUNDED
                : PaymentStatus.PARTIALLY_REFUNDED;
    }

    /** The hotel or airline confirmed the cancellation. */
    public void cancelled(Instant at) {
        this.cancelledAt = at;
    }

    /** Puts the booking in the support "Needs attention" queue (latest reason; {@code since} = first flagged). */
    public void needsAttention(String reason, String note, Instant now) {
        if (attentionReason == null) {
            this.attentionSince = now;
        }
        this.attentionReason = reason;
        this.attentionNote = note == null || note.length() <= 500 ? note : note.substring(0, 500);
    }

    /** Clears the flag; with {@code reasons} only when it is one of them (the problem went away by itself). */
    public void attentionResolved(String... reasons) {
        if (attentionReason == null) {
            return;
        }
        if (reasons.length > 0 && java.util.Arrays.stream(reasons).noneMatch(attentionReason::equals)) {
            return;
        }
        this.attentionReason = null;
        this.attentionNote = null;
        this.attentionSince = null;
    }

    public void confirmed(Instant at) {
        this.confirmedAt = at;
    }

    /** The customer can (still) start a payment. */
    public boolean isPayable(Instant now) {
        return status == BookingStatus.PENDING_PAYMENT && paymentDeadline != null && now.isBefore(paymentDeadline);
    }
}
