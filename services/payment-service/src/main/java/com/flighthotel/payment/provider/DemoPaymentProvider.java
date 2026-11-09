package com.flighthotel.payment.provider;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

/**
 * The DEMO provider (PAYMENT_INTEGRATION.md §1): no money, no account, but the whole backend flow runs for real
 * (order, signed callback, verification, events). It has no state: the outcome is part of the payment id
 * ({@code pay_demo_ok_...} / {@code pay_demo_fail_...}) and the callback is signed with a demo secret, so a browser
 * cannot make up a successful payment. Only created when {@code payment.demo.enabled=true}; never in production.
 */
public class DemoPaymentProvider implements PaymentProvider {

    public static final String CODE = "DEMO";
    static final String PAID = "pay_demo_ok_";
    static final String FAILED = "pay_demo_fail_";

    private final String secret;

    public DemoPaymentProvider(String secret) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("payment.demo.secret must be set when the DEMO provider is enabled");
        }
        this.secret = secret;
    }

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public ProviderOrder createOrder(BigDecimal amount, String currency, String receipt, String idempotencyKey) {
        return new ProviderOrder("order_demo_" + id(), amount, currency);
    }

    /** What the demo page does when the customer presses Pay (or Fail): a payment id and the signed callback. */
    public DemoCheckout checkout(String providerOrderId, boolean success) {
        String paymentId = (success ? PAID : FAILED) + id();
        return new DemoCheckout(providerOrderId, paymentId, sign(providerOrderId, paymentId));
    }

    @Override
    public boolean verifyCheckoutSignature(String providerOrderId, String providerPaymentId, String signature) {
        return Signatures.matches((providerOrderId + "|" + providerPaymentId).getBytes(StandardCharsets.UTF_8),
                secret, signature);
    }

    @Override
    public boolean verifyWebhookSignature(byte[] rawBody, String signatureHeader) {
        return Signatures.matches(rawBody, secret, signatureHeader);
    }

    @Override
    public ProviderPayment fetchPayment(String providerPaymentId) {
        if (providerPaymentId.startsWith(PAID)) {
            // The amount is not known without state: the caller compares it with the order only when it is present.
            return new ProviderPayment(providerPaymentId, null, PaymentState.CAPTURED, null, null, "demo", null, null);
        }
        if (providerPaymentId.startsWith(FAILED)) {
            return new ProviderPayment(providerPaymentId, null, PaymentState.FAILED, null, null, "demo",
                    "DEMO_DECLINED", "The demo payment was declined (Fail button).");
        }
        throw new ProviderException("Unknown demo payment " + providerPaymentId, true);
    }

    @Override
    public List<ProviderPayment> fetchOrderPayments(String providerOrderId) {
        // Nothing to look up: a demo payment that was never reported back simply did not happen.
        return List.of();
    }

    @Override
    public ProviderRefund refund(String providerPaymentId, BigDecimal amount, String idempotencyKey) {
        return new ProviderRefund("rfnd_demo_" + id(), providerPaymentId, RefundState.PROCESSED, amount, null);
    }

    @Override
    public ProviderRefund fetchRefund(String providerRefundId) {
        return new ProviderRefund(providerRefundId, null, RefundState.PROCESSED, null, null);
    }

    private String sign(String orderId, String paymentId) {
        return Signatures.hmacSha256Hex(orderId + "|" + paymentId, secret);
    }

    private static String id() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 14);
    }

    public record DemoCheckout(String orderId, String paymentId, String signature) {
    }
}
