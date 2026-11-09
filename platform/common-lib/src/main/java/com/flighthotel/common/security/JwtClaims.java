package com.flighthotel.common.security;

/** Names of the custom claims identity-service writes into access tokens. */
public final class JwtClaims {

    /** User roles, e.g. ["CUSTOMER"]. */
    public static final String ROLES = "roles";
    /** Fine-grained permissions, e.g. ["BOOKING_READ_ANY"]. */
    public static final String PERMISSIONS = "permissions";
    public static final String EMAIL = "email";

    private JwtClaims() {
    }
}
