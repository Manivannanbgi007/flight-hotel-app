package com.flighthotel.testsupport;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;

/**
 * Access tokens for the four roles with exactly the permissions identity-service gives them
 * ({@code V3__roles_and_permissions.sql}), so a security test checks what a real account of that role can do.
 */
public final class RoleTokens {

    public static final String CUSTOMER = "CUSTOMER";
    public static final String HOTEL_MANAGER = "HOTEL_MANAGER";
    public static final String SUPPORT_AGENT = "SUPPORT_AGENT";
    public static final String ADMIN = "ADMIN";

    /** Role → its permissions. ADMIN has every permission except the hotel-manager-only one. */
    public static final Map<String, Set<String>> PERMISSIONS = Map.of(
            CUSTOMER, Set.of(),
            HOTEL_MANAGER, Set.of("HOTEL_MANAGE_ASSIGNED"),
            SUPPORT_AGENT, Set.of("BOOKING_READ_ANY", "BOOKING_MANAGE_ANY", "PAYMENT_READ_ANY",
                    "SUPPORT_TICKET_MANAGE", "USER_READ_ANY"),
            ADMIN, Set.of("USER_READ_ANY", "USER_MANAGE", "BOOKING_READ_ANY", "BOOKING_MANAGE_ANY",
                    "PAYMENT_READ_ANY", "REFUND_MANAGE", "HOTEL_MANAGE_ANY", "FLIGHT_PROVIDER_MANAGE",
                    "REVIEW_MODERATE", "COUPON_MANAGE", "SUPPORT_TICKET_MANAGE", "REPORT_VIEW", "AUDIT_VIEW",
                    "SETTINGS_MANAGE"));

    private RoleTokens() {
    }

    /** A token of a new user (random id) with this role. */
    public static JwtRequestPostProcessor as(String role) {
        return as(UUID.randomUUID(), role);
    }

    public static JwtRequestPostProcessor as(UUID userId, String role) {
        Set<String> permissions = PERMISSIONS.get(role);
        if (permissions == null) {
            throw new IllegalArgumentException("Unknown role " + role);
        }
        List<GrantedAuthority> authorities = new ArrayList<>();
        authorities.add(new SimpleGrantedAuthority("ROLE_" + role));
        permissions.forEach(permission -> authorities.add(new SimpleGrantedAuthority(permission)));
        return jwt().jwt(token -> token.subject(userId.toString())
                        .claim("email", role.toLowerCase() + "-" + userId + "@example.com")
                        .claim("roles", List.of(role))
                        .claim("permissions", List.copyOf(permissions)))
                .authorities(authorities);
    }
}
