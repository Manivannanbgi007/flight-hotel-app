package com.flighthotel.identity.security;

import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Set;

import com.flighthotel.common.security.Roles;

/**
 * The sign-in pages of the web app (IMPLEMENTATION_PLAN.md Phase 11 §11.2) and the roles each one admits. Admins may
 * also use the hotel manager and support sign-ins, because they hold those permissions (as in the gateway's
 * {@code gateway.role-paths}).
 */
public enum Portal {
    CUSTOMER(Set.of(Roles.CUSTOMER)),
    ADMIN(Set.of(Roles.ADMIN)),
    HOTEL_MANAGER(Set.of(Roles.HOTEL_MANAGER, Roles.ADMIN)),
    SUPPORT(Set.of(Roles.SUPPORT_AGENT, Roles.ADMIN));

    /** For the request's {@code @Pattern}. */
    public static final String NAMES = "CUSTOMER|ADMIN|HOTEL_MANAGER|SUPPORT";

    private final Set<String> roles;

    Portal(Set<String> roles) {
        this.roles = roles;
    }

    public boolean admits(Collection<String> userRoles) {
        return userRoles.stream().anyMatch(roles::contains);
    }

    /** The portals an account with these roles may use, in declaration order. */
    public static List<Portal> forRoles(Collection<String> userRoles) {
        return Arrays.stream(values()).filter(portal -> portal.admits(userRoles)).toList();
    }

    /**
     * The staff sign-in page an invitation e-mail leads to after the password is set (the web app's path segment):
     * {@code admin}, {@code hotel-manager} or {@code support}, the first role in that order; null for customers.
     */
    public static String invitationSignIn(Collection<String> userRoles) {
        if (userRoles.contains(Roles.ADMIN)) {
            return "admin";
        }
        if (userRoles.contains(Roles.HOTEL_MANAGER)) {
            return "hotel-manager";
        }
        return userRoles.contains(Roles.SUPPORT_AGENT) ? "support" : null;
    }
}
