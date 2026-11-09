package com.flighthotel.payment.config;

import java.util.Map;
import java.util.Optional;

import com.flighthotel.payment.provider.PaymentProvider;

/**
 * The providers this instance can talk to. New orders use the {@linkplain #active() active} one; payments, refunds
 * and webhooks of earlier orders are handled by the provider that created them ({@link #byCode}).
 */
public class PaymentProviders {

    private final Map<String, PaymentProvider> available;
    private final String activeCode;

    PaymentProviders(Map<String, PaymentProvider> available, String activeCode) {
        this.available = Map.copyOf(available);
        this.activeCode = activeCode;
    }

    public PaymentProvider active() {
        return available.get(activeCode);
    }

    public Optional<PaymentProvider> find(String code) {
        return Optional.ofNullable(available.get(code));
    }

    public PaymentProvider byCode(String code) {
        return find(code).orElseThrow(() -> new IllegalStateException("Payment provider " + code + " is not enabled"));
    }
}
