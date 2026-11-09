package com.flighthotel.identity.entity;

/** Account lifecycle: registered → email verified (ACTIVE) → possibly deactivated by an admin. */
public enum UserStatus {
    PENDING_VERIFICATION, ACTIVE, DEACTIVATED
}
