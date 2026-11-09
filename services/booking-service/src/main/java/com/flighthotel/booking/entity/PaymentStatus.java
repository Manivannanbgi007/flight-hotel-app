package com.flighthotel.booking.entity;

/** The booking's view of its money, kept up to date from payment events. */
public enum PaymentStatus {
    /** Nothing paid yet. */
    UNPAID,
    /** The last attempt failed; the customer may try again until the deadline. */
    PAYMENT_FAILED,
    PAID,
    REFUND_PENDING,
    /** Part of the money came back (a cancellation fee was kept). */
    PARTIALLY_REFUNDED,
    REFUNDED
}
