package com.flighthotel.common.security;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/** The logged-in user, taken from the validated access token. */
public record AuthenticatedUser(UUID id, String email, Set<String> roles, Set<String> permissions,
                                Instant tokenExpiresAt) {

    public boolean hasRole(String role) {
        return roles.contains(role);
    }

    public boolean hasPermission(String permission) {
        return permissions.contains(permission);
    }
}
