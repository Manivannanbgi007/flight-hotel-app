package com.flighthotel.booking.entity;

public enum BookingType {
    HOTEL, FLIGHT;

    /** Prefix of the human-friendly booking reference, e.g. {@code HT-7K3M9Q2X}. */
    public String referencePrefix() {
        return this == HOTEL ? "HT" : "FL";
    }
}
