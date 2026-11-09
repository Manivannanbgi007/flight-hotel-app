package com.flighthotel.common.security;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/** Static helpers to read the current user in services. Controllers can also inject {@code @AuthenticationPrincipal Jwt}. */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static Optional<AuthenticatedUser> get() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken jwtAuth) {
            return Optional.of(fromJwt(jwtAuth.getToken()));
        }
        return Optional.empty();
    }

    /** The current user, or an exception if the request is anonymous (should never happen on protected endpoints). */
    public static AuthenticatedUser require() {
        return get().orElseThrow(() -> new IllegalStateException("No authenticated user in security context"));
    }

    public static AuthenticatedUser fromJwt(Jwt jwt) {
        return new AuthenticatedUser(
                UUID.fromString(jwt.getSubject()),
                jwt.getClaimAsString(JwtClaims.EMAIL),
                stringSet(jwt.getClaim(JwtClaims.ROLES)),
                stringSet(jwt.getClaim(JwtClaims.PERMISSIONS)),
                jwt.getExpiresAt());
    }

    static Set<String> stringSet(Object claim) {
        Set<String> values = new LinkedHashSet<>();
        if (claim instanceof Collection<?> collection) {
            collection.forEach(v -> values.add(String.valueOf(v)));
        }
        return Set.copyOf(values);
    }
}
