package com.flighthotel.hotel.entity;

/** Moderation state of a {@link Review}. Only APPROVED reviews are public and count towards the hotel's rating. */
public enum ReviewStatus {
    /** Written by the guest, waiting for a moderator. */
    PENDING,
    /** Public. */
    APPROVED,
    /** Not published; the author sees the moderator's reason. */
    REJECTED
}
