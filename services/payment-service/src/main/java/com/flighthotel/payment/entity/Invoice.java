package com.flighthotel.payment.entity;

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

/** The tax invoice of a confirmed booking (one per booking). The PDF is made in Phase 8 from these values. */
@Getter
@Entity
@Table(name = "invoices")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Invoice {

    @Id
    private UUID id;

    @Column(name = "invoice_number", nullable = false, updatable = false, length = 30)
    private String invoiceNumber;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(name = "booking_reference", nullable = false, updatable = false, length = 12)
    private String bookingReference;

    @Column(name = "payment_id", nullable = false, updatable = false)
    private UUID paymentId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "billing_name", nullable = false, updatable = false, length = 150)
    private String billingName;

    @Column(name = "billing_email", nullable = false, updatable = false, length = 254)
    private String billingEmail;

    @Column(nullable = false, updatable = false, length = 255)
    private String description;

    @Column(nullable = false, updatable = false, length = 3)
    private String currency;

    @Column(name = "taxable_amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal taxableAmount;

    @Column(name = "tax_amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal taxAmount;

    @Column(name = "discount_amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal discountAmount;

    @Column(name = "total_amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal totalAmount;

    @Column(name = "issued_at", nullable = false, updatable = false)
    private Instant issuedAt;

    public Invoice(String invoiceNumber, UUID bookingId, String bookingReference, UUID paymentId, UUID userId,
            String billingName, String billingEmail, String description, String currency, BigDecimal taxableAmount,
            BigDecimal taxAmount, BigDecimal discountAmount, BigDecimal totalAmount, Instant issuedAt) {
        this.id = UuidV7.generate();
        this.invoiceNumber = invoiceNumber;
        this.bookingId = bookingId;
        this.bookingReference = bookingReference;
        this.paymentId = paymentId;
        this.userId = userId;
        this.billingName = billingName.length() > 150 ? billingName.substring(0, 150) : billingName;
        this.billingEmail = billingEmail;
        this.description = description.length() > 255 ? description.substring(0, 255) : description;
        this.currency = currency;
        this.taxableAmount = taxableAmount;
        this.taxAmount = taxAmount;
        this.discountAmount = discountAmount;
        this.totalAmount = totalAmount;
        this.issuedAt = issuedAt;
    }
}
