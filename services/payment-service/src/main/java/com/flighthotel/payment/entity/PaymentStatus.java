package com.flighthotel.payment.entity;

/** PAYMENT_INTEGRATION.md section 4. Statuses only move forward. */
public enum PaymentStatus {
    INITIATED, PENDING, SUCCESS, FAILED, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED;

    /** The customer is (or may still be) paying: at most one such attempt exists per booking. */
    public boolean isOpen() {
        return this == INITIATED || this == PENDING;
    }

    /** Money was captured (and maybe given back partly). */
    public boolean isPaid() {
        return this == SUCCESS || this == REFUND_PENDING || this == PARTIALLY_REFUNDED || this == REFUNDED;
    }
}
