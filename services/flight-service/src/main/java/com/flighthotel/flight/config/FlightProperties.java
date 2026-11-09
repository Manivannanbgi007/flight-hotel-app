package com.flighthotel.flight.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Settings of flight-service ({@code flight.*}). */
@ConfigurationProperties("flight")
public record FlightProperties(Duration offerTtl, Duration holdDuration, Reconcile reconcile, Demo demo) {

    public FlightProperties {
        offerTtl = offerTtl == null ? Duration.ofMinutes(20) : offerTtl;
        holdDuration = holdDuration == null ? Duration.ofMinutes(20) : holdDuration;
        reconcile = reconcile == null ? new Reconcile(3, Duration.ofMinutes(5), Duration.ofHours(2)) : reconcile;
        demo = demo == null ? new Demo(true, 0, 0) : demo;
    }

    /**
     * Reconciliation of unknown supplier outcomes (BOOKING_WORKFLOW.md section 3): look the order up again with a
     * growing pause; when the supplier still knows nothing after {@code maxAttempts} looks and {@code notFoundAfter},
     * the order does not exist and the customer is refunded; after {@code escalateAfter} a person must decide.
     */
    public record Reconcile(int maxAttempts, Duration notFoundAfter, Duration escalateAfter) {
    }

    /** The DEMO provider: seed data and the simulation switches (SUPPLIER_INTEGRATION.md section 4). */
    public record Demo(boolean enabled, double failureRate, double timeoutRate) {
    }
}
