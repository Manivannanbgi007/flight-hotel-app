package com.flighthotel.hotel.entity;

/** Only ACTIVE hotels are visible to customers. New hotels start as DRAFT. */
public enum HotelStatus {
    DRAFT, ACTIVE, INACTIVE
}
