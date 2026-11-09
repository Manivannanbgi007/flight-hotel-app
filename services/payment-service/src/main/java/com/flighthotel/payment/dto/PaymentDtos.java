package com.flighthotel.payment.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Request and response shapes of the payment API. Amounts are rupee amounts (never paise). */
public final class PaymentDtos {

    private PaymentDtos() {
    }

    public record CreateOrderRequest(@NotNull UUID bookingId) {
    }

    /**
     * Everything the payment page needs. {@code keyId} is Razorpay's public Key ID (null for DEMO); the amount is the
     * booking's total as the server knows it.
     */
    public record OrderResponse(UUID paymentId, UUID bookingId, String bookingReference, String provider,
            String orderId, String keyId, BigDecimal amount, String currency, String description,
            String contactEmail, Instant paymentDeadline, String status) {
    }

    /** The browser's callback after checkout, passed on unchanged and checked by the server. */
    public record VerifyRequest(@NotBlank @Size(max = 64) String orderId, @NotBlank @Size(max = 64) String paymentId,
            @NotBlank @Size(max = 200) String signature) {
    }

    public record FailureReport(@NotBlank @Size(max = 64) String orderId, @NotBlank @Size(max = 64) String paymentId) {
    }

    public record DemoOrderRequest(@NotBlank @Size(max = 64) String orderId) {
    }

    public record PaymentResult(UUID paymentId, UUID bookingId, String status, String method, BigDecimal amount,
            String currency, String failureCode, String failureMessage) {
    }

    public record PaymentSummary(UUID id, UUID bookingId, String bookingReference, String description,
            String provider, BigDecimal amount, BigDecimal refundedAmount, String currency, String status,
            String method, String failureMessage, Instant createdAt, Instant verifiedAt, String invoiceNumber,
            String bookingType) {
    }

    /**
     * The customer's figures above Payment History, for the same filters as the list. {@code paidAmount} is what was
     * captured (before refunds), {@code refundedAmount} what came back; {@code pending} are attempts still open.
     */
    public record MyPaymentsSummary(long total, long successful, long failed, long pending, BigDecimal paidAmount,
            BigDecimal refundedAmount, String currency) {
    }

    public record InvoiceView(UUID id, String invoiceNumber, UUID bookingId, String bookingReference, UUID paymentId,
            String billingName, String billingEmail, String description, String currency, BigDecimal taxableAmount,
            BigDecimal taxAmount, BigDecimal discountAmount, BigDecimal totalAmount, Instant issuedAt) {
    }
}
