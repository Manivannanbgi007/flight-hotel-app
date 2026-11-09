package com.flighthotel.payment.provider;

import java.math.BigDecimal;
import java.util.List;

/**
 * What payment-service needs from a payment provider (PAYMENT_INTEGRATION.md §1). Amounts are ordinary rupee amounts
 * here; a provider that works in the smallest currency unit (Razorpay: paise) converts inside its own adapter.
 */
public interface PaymentProvider {

    /** RAZORPAY or DEMO; stored with every payment so old payments keep working when the provider is switched. */
    String code();

    /** Creates the order the customer pays. The provider's own order id is returned. */
    ProviderOrder createOrder(BigDecimal amount, String currency, String receipt, String idempotencyKey);

    /** The browser's callback after checkout: HMAC_SHA256(orderId|paymentId, secret) must equal the signature. */
    boolean verifyCheckoutSignature(String providerOrderId, String providerPaymentId, String signature);

    /** HMAC_SHA256(rawBody, webhookSecret) in constant time; the raw bytes are checked before any parsing. */
    boolean verifyWebhookSignature(byte[] rawBody, String signatureHeader);

    /** The provider's own view of one payment: the truth, whatever the browser says. */
    ProviderPayment fetchPayment(String providerPaymentId);

    /** The payments made against an order (reconciliation: the browser never reported back). */
    List<ProviderPayment> fetchOrderPayments(String providerOrderId);

    /** Starts a refund. Repeating a call with the same idempotency key must not refund twice. */
    ProviderRefund refund(String providerPaymentId, BigDecimal amount, String idempotencyKey);

    ProviderRefund fetchRefund(String providerRefundId);

    record ProviderOrder(String orderId, BigDecimal amount, String currency) {
    }

    enum PaymentState {
        /** Not paid yet, or authorised but not captured yet. */
        PENDING,
        CAPTURED,
        FAILED
    }

    record ProviderPayment(String paymentId, String orderId, PaymentState state, BigDecimal amount, String currency,
            String method, String errorCode, String errorDescription) {
    }

    enum RefundState {
        PENDING,
        PROCESSED,
        FAILED
    }

    record ProviderRefund(String refundId, String paymentId, RefundState state, BigDecimal amount, String failure) {
    }
}
