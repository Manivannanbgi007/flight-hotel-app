package com.flighthotel.payment.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Settings of payment-service ({@code payment.*}). Secrets only come from the environment (local {@code .env}).
 */
@ConfigurationProperties("payment")
public record PaymentProperties(String provider, Demo demo, Razorpay razorpay, Reconciliation reconciliation) {

    public PaymentProperties {
        provider = provider == null || provider.isBlank() ? "demo" : provider.strip().toLowerCase(java.util.Locale.ROOT);
        demo = demo == null ? new Demo(false, "") : demo;
        razorpay = razorpay == null ? new Razorpay("", "", "", "https://api.razorpay.com/v1", Duration.ofSeconds(10))
                : razorpay;
        reconciliation = reconciliation == null
                ? new Reconciliation(Duration.ofMinutes(10), Duration.ofMinutes(30), Duration.ofHours(1))
                : reconciliation;
    }

    /** The DEMO provider: a labelled "Demo payment" page with Pay / Fail buttons. Never enabled in production. */
    public record Demo(boolean enabled, String secret) {
    }

    public record Razorpay(String keyId, String keySecret, String webhookSecret, String apiUrl, Duration timeout) {

        public boolean configured() {
            return keyId != null && !keyId.isBlank() && keySecret != null && !keySecret.isBlank();
        }
    }

    /** PAYMENT_INTEGRATION.md §6: how old an open payment / refund must be before we ask the provider. */
    public record Reconciliation(Duration paymentAfter, Duration refundAfter, Duration abandonAfter) {
    }
}
