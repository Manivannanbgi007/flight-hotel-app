package com.flighthotel.hotel.entity;

/**
 * Life of a {@link HotelReservation}. HELD rooms count as {@code held_rooms}, CONFIRMED ones as {@code booked_rooms}
 * in {@code room_inventory}; EXPIRED, RELEASED and CANCELLED rooms are back on sale. CHECKED_IN, CHECKED_OUT and
 * NO_SHOW stays keep their booked rooms for the nights that have passed; an early check-out or a no-show puts the
 * nights still to come back on sale (FrontDeskService).
 */
public enum ReservationStatus {
    /** Rooms taken out of sale until {@code hold_expires_at}, waiting for payment. */
    HELD,
    /** Paid: the rooms are booked. */
    CONFIRMED,
    /** The guests arrived (hotel manager portal, Phase 9). */
    CHECKED_IN,
    /** The guests left; the stay is completed and may be reviewed. */
    CHECKED_OUT,
    /** The guests never arrived; the stay stays paid (no refund). */
    NO_SHOW,
    /** Not paid in time; the rooms went back on sale. */
    EXPIRED,
    /** Given back on booking-service's request (booking failed or expired there). */
    RELEASED,
    /**
     * A confirmed reservation cancelled by the customer (Phase 7) or by the hotel itself (Phase 9, see
     * {@code cancelled_by}): the booked rooms are back on sale.
     */
    CANCELLED
}
