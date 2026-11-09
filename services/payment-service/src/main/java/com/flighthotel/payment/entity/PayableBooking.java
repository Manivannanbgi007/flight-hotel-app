package com.flighthotel.payment.entity;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

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
 * What payment-service knows about a booking, copied from booking-service events. The amount to charge is only
 * ever taken from here, never from the browser.
 */
@Getter
@Entity
@Table(name = "payable_bookings")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PayableBooking extends AuditableEntity {

    @Id
    @Column(name = "booking_id")
    private UUID bookingId;

    @Column(name = "booking_reference", nullable = false, updatable = false, length = 12)
    private String bookingReference;

    /** HOTEL or FLIGHT; null only for rows that predate the column and have an unknown reference prefix. */
    @Column(name = "booking_type", updatable = false, length = 10)
    private String bookingType;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal amount;

    @Column(nullable = false, length = 3, updatable = false)
    private String currency;

    @Column(nullable = false, length = 255)
    private String description;

    @Column(name = "contact_email", nullable = false, length = 254)
    private String contactEmail;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 20)
    private PayableStatus status;

    @Column(name = "payment_deadline", nullable = false)
    private Instant paymentDeadline;

    @Version
    private Long version;

    public PayableBooking(UUID bookingId, String bookingReference, String bookingType, UUID userId, BigDecimal amount,
            String currency, String description, String contactEmail, Instant paymentDeadline) {
        this.bookingId = bookingId;
        this.bookingReference = bookingReference;
        this.bookingType = bookingType;
        this.userId = userId;
        this.amount = amount;
        this.currency = currency;
        this.description = description.length() > 255 ? description.substring(0, 255) : description;
        this.contactEmail = contactEmail;
        this.paymentDeadline = paymentDeadline;
        this.status = PayableStatus.AWAITING_PAYMENT;
    }

    /** Orders may only be created while the booking waits for money and the payment window is open. */
    public boolean acceptsNewOrder(Instant now) {
        return status == PayableStatus.AWAITING_PAYMENT && now.isBefore(paymentDeadline);
    }

    /** A payment that arrives after expiry is still money received (booking-service refunds it). */
    public void paid() {
        this.status = PayableStatus.PAID;
    }

    public void expired() {
        if (status == PayableStatus.AWAITING_PAYMENT) {
            this.status = PayableStatus.EXPIRED;
        }
    }

    public void cancelled() {
        if (status == PayableStatus.AWAITING_PAYMENT) {
            this.status = PayableStatus.CANCELLED;
        }
    }
}
