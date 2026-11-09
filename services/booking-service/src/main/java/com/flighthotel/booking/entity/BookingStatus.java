package com.flighthotel.booking.entity;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * The booking state machine of BOOKING_WORKFLOW.md §1. A booking only moves along the arrows below; anything else is
 * a programming error ({@link Booking#moveTo}).
 */
public enum BookingStatus {
    INITIATED,
    PENDING_PAYMENT,
    PAYMENT_SUCCESS,
    SUPPLIER_PENDING,
    CONFIRMED,
    COMPLETED,
    CANCELLATION_PENDING,
    CANCELLED,
    REFUND_PENDING,
    REFUNDED,
    FAILED,
    EXPIRED;

    private static final Map<BookingStatus, Set<BookingStatus>> NEXT = Map.ofEntries(
            Map.entry(INITIATED, EnumSet.of(PENDING_PAYMENT, FAILED)),
            Map.entry(PENDING_PAYMENT, EnumSet.of(PAYMENT_SUCCESS, EXPIRED, FAILED)),
            Map.entry(PAYMENT_SUCCESS, EnumSet.of(SUPPLIER_PENDING)),
            Map.entry(SUPPLIER_PENDING, EnumSet.of(CONFIRMED, REFUND_PENDING)),
            Map.entry(CONFIRMED, EnumSet.of(COMPLETED, CANCELLATION_PENDING)),
            Map.entry(CANCELLATION_PENDING, EnumSet.of(CANCELLED, CONFIRMED)),
            Map.entry(CANCELLED, EnumSet.of(REFUND_PENDING)),
            // A payment that arrives after the booking expired/failed is refunded.
            Map.entry(EXPIRED, EnumSet.of(REFUND_PENDING)),
            Map.entry(FAILED, EnumSet.of(REFUND_PENDING)),
            Map.entry(REFUND_PENDING, EnumSet.of(REFUNDED)),
            Map.entry(REFUNDED, EnumSet.noneOf(BookingStatus.class)),
            Map.entry(COMPLETED, EnumSet.noneOf(BookingStatus.class)));

    public boolean canMoveTo(BookingStatus next) {
        return NEXT.get(this).contains(next);
    }

    /** The My Trips tab the booking is listed under. */
    public BookingTab tab() {
        return switch (this) {
            case INITIATED, PENDING_PAYMENT, PAYMENT_SUCCESS, SUPPLIER_PENDING -> BookingTab.PENDING;
            case CONFIRMED, CANCELLATION_PENDING -> BookingTab.UPCOMING;
            case COMPLETED -> BookingTab.COMPLETED;
            case CANCELLED, REFUND_PENDING, REFUNDED, FAILED, EXPIRED -> BookingTab.CANCELLED;
        };
    }

    /** The supplier/hotel confirmed it: confirmation numbers and vouchers may be shown (golden rule 3). */
    public boolean isConfirmedOrLater() {
        return this == CONFIRMED || this == COMPLETED || this == CANCELLATION_PENDING || this == CANCELLED;
    }
}
