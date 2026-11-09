package com.flighthotel.identity.entity;

/** Why a refresh token (session) ended. */
public enum RevokeReason {
    ROTATED, LOGOUT, LOGOUT_ALL, PASSWORD_CHANGED, PASSWORD_RESET, DEACTIVATED, REUSE_DETECTED
}
