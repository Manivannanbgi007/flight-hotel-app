package com.flighthotel.common.security;

/** The four user roles. Spring Security sees them as authorities with the {@code ROLE_} prefix. */
public final class Roles {

    public static final String CUSTOMER = "CUSTOMER";
    public static final String ADMIN = "ADMIN";
    public static final String HOTEL_MANAGER = "HOTEL_MANAGER";
    public static final String SUPPORT_AGENT = "SUPPORT_AGENT";

    private Roles() {
    }
}
