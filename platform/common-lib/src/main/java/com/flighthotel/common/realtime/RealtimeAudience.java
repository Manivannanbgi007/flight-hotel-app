package com.flighthotel.common.realtime;

import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * Who may receive a realtime message: specific users and/or everyone with a role.
 * <p>
 * The publisher decides this on the server. It is never sent to browsers, and browsers cannot choose what to
 * subscribe to.
 */
public record RealtimeAudience(Set<String> userIds, Set<String> roles) {

    public RealtimeAudience {
        userIds = userIds == null ? Set.of() : Set.copyOf(userIds);
        roles = roles == null ? Set.of() : Set.copyOf(roles);
        if (userIds.isEmpty() && roles.isEmpty()) {
            throw new IllegalArgumentException("A realtime audience needs at least one user or role");
        }
    }

    public static RealtimeAudience user(UUID userId) {
        return new RealtimeAudience(Set.of(userId.toString()), Set.of());
    }

    public static RealtimeAudience users(Collection<UUID> userIds) {
        return new RealtimeAudience(userIds.stream().map(UUID::toString).collect(java.util.stream.Collectors.toSet()),
                Set.of());
    }

    public static RealtimeAudience roles(String... roles) {
        return new RealtimeAudience(Set.of(), Set.of(roles));
    }

    /** Adds roles, e.g. {@code RealtimeAudience.user(ownerId).andRoles(Roles.ADMIN, Roles.SUPPORT_AGENT)}. */
    public RealtimeAudience andRoles(String... moreRoles) {
        Set<String> merged = new HashSet<>(roles);
        merged.addAll(Set.of(moreRoles));
        return new RealtimeAudience(userIds, merged);
    }

    public boolean includes(String userId, Collection<String> userRoles) {
        if (userIds.contains(userId)) {
            return true;
        }
        for (String role : userRoles) {
            if (roles.contains(role)) {
                return true;
            }
        }
        return false;
    }
}
