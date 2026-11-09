package com.flighthotel.flight.entity;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * flight-service's record of one booking: the held seats, then the supplier order. Statuses:
 * HELD, CONFIRMED, FAILED, UNCERTAIN (supplier did not answer), NEEDS_ATTENTION (still unknown after a long time),
 * RELEASED (given back on booking-service's request), EXPIRED (not paid in time), and for cancellations (Phase 7)
 * CANCEL_UNCERTAIN (the airline did not answer the cancellation) and CANCELLED.
 */
@Getter
@Entity
@Table(name = "flight_supplier_bookings")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SupplierBooking extends AuditableEntity {

    public static final String HELD = "HELD";
    public static final String CONFIRMED = "CONFIRMED";
    public static final String FAILED = "FAILED";
    public static final String UNCERTAIN = "UNCERTAIN";
    public static final String NEEDS_ATTENTION = "NEEDS_ATTENTION";
    public static final String RELEASED = "RELEASED";
    public static final String EXPIRED = "EXPIRED";
    public static final String CANCEL_UNCERTAIN = "CANCEL_UNCERTAIN";
    public static final String CANCELLED = "CANCELLED";

    @Id
    private UUID id;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(name = "booking_reference", nullable = false, updatable = false, length = 12)
    private String bookingReference;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "provider_code", nullable = false, updatable = false, length = 20)
    private String providerCode;

    @Column(name = "offer_id", nullable = false, updatable = false, length = 40)
    private String offerId;

    @Column(name = "idempotency_key", nullable = false, updatable = false, length = 64)
    private String idempotencyKey;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(nullable = false, updatable = false, length = 200)
    private String title;

    @Column(name = "trip_json", nullable = false, updatable = false, columnDefinition = "MEDIUMTEXT")
    private String tripJson;

    @Column(name = "passengers_json", nullable = false, updatable = false, columnDefinition = "TEXT")
    private String passengersJson;

    @Column(nullable = false, updatable = false)
    private int adults;

    @Column(nullable = false, updatable = false)
    private int children;

    @Column(nullable = false, updatable = false)
    private int infants;

    @Column(nullable = false, updatable = false, length = 3)
    private String currency;

    @Column(name = "total_amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal totalAmount;

    @Column(name = "hold_expires_at", nullable = false)
    private Instant holdExpiresAt;

    @Column(name = "supplier_order_id", length = 20)
    private String supplierOrderId;

    @Column(length = 6)
    private String pnr;

    @Column(nullable = false)
    private int attempts;

    @Column(name = "last_error_code", length = 40)
    private String lastErrorCode;

    @Column(name = "uncertain_since")
    private Instant uncertainSince;

    @Column(name = "next_reconcile_at")
    private Instant nextReconcileAt;

    @Column(name = "cancellation_id", length = 36)
    private String cancellationId;

    @Column(name = "cancellation_reference", length = 20)
    private String cancellationReference;

    @Column(name = "cancel_fee", precision = 12, scale = 2)
    private BigDecimal cancelFee;

    @Column(name = "cancel_refund", precision = 12, scale = 2)
    private BigDecimal cancelRefund;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Version
    private Long version;

    public record Held(UUID bookingId, String bookingReference, UUID userId, String providerCode, String offerId,
            String title, String tripJson, String passengersJson, int adults, int children, int infants,
            String currency, BigDecimal totalAmount) {
    }

    public static SupplierBooking held(Held held, Instant expiresAt) {
        SupplierBooking booking = new SupplierBooking();
        booking.id = UuidV7.generate();
        booking.bookingId = held.bookingId();
        booking.bookingReference = held.bookingReference();
        booking.userId = held.userId();
        booking.providerCode = held.providerCode();
        booking.offerId = held.offerId();
        booking.idempotencyKey = held.bookingId().toString();
        booking.status = HELD;
        booking.title = held.title();
        booking.tripJson = held.tripJson();
        booking.passengersJson = held.passengersJson();
        booking.adults = held.adults();
        booking.children = held.children();
        booking.infants = held.infants();
        booking.currency = held.currency();
        booking.totalAmount = held.totalAmount();
        booking.holdExpiresAt = expiresAt;
        return booking;
    }

    public boolean isHeld() {
        return HELD.equals(status);
    }

    public int seatsPerSlice() {
        return adults + children;
    }

    public void confirmed(String supplierOrderId, String pnr) {
        this.status = CONFIRMED;
        this.supplierOrderId = supplierOrderId;
        this.pnr = pnr;
        this.nextReconcileAt = null;
        this.lastErrorCode = null;
    }

    public void failed(String errorCode) {
        this.status = FAILED;
        this.lastErrorCode = errorCode;
        this.nextReconcileAt = null;
    }

    public void uncertain(Instant now, Instant nextLook) {
        this.status = UNCERTAIN;
        this.lastErrorCode = "SUPPLIER_TIMEOUT";
        this.uncertainSince = now;
        this.nextReconcileAt = nextLook;
    }

    public void looked(Instant nextLook, String errorCode) {
        this.attempts++;
        this.nextReconcileAt = nextLook;
        this.lastErrorCode = errorCode;
    }

    public void needsAttention() {
        this.status = NEEDS_ATTENTION;
        this.nextReconcileAt = null;
    }

    public void released(String status) {
        this.status = status;
    }

    /** The airline cancelled the order. */
    public void cancelled(String cancellationId, String reference, BigDecimal fee, BigDecimal refund, Instant at) {
        this.status = CANCELLED;
        this.cancellationId = cancellationId;
        this.cancellationReference = reference;
        this.cancelFee = fee;
        this.cancelRefund = refund;
        this.cancelledAt = at;
        this.nextReconcileAt = null;
        this.lastErrorCode = null;
    }

    /** The airline did not answer the cancellation: look it up later, never cancel blindly again. */
    public void cancelUncertain(String cancellationId, Instant now, Instant nextLook) {
        this.status = CANCEL_UNCERTAIN;
        this.cancellationId = cancellationId;
        this.attempts = 0;
        this.uncertainSince = now;
        this.nextReconcileAt = nextLook;
        this.lastErrorCode = "CANCEL_TIMEOUT";
    }

    /** The airline never cancelled: the tickets stay valid and a new cancellation may be asked for. */
    public void cancellationNotConfirmed() {
        this.status = CONFIRMED;
        this.cancellationId = null;
        this.nextReconcileAt = null;
        this.lastErrorCode = "CANCEL_NOT_CONFIRMED";
    }

    /** Paid after the hold ran out and the seats were taken again. */
    public void reheld(Instant newExpiry) {
        this.status = HELD;
        this.holdExpiresAt = newExpiry;
    }
}
