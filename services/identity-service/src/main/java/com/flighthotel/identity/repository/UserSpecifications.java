package com.flighthotel.identity.repository;

import java.util.Locale;

import jakarta.persistence.criteria.Join;

import org.springframework.data.jpa.domain.Specification;

import com.flighthotel.identity.entity.Role;
import com.flighthotel.identity.entity.User;
import com.flighthotel.identity.entity.UserStatus;

/** Filters for the admin user list. Each one is skipped when its value is null. */
public final class UserSpecifications {

    private UserSpecifications() {
    }

    public static Specification<User> matchesSearch(String search) {
        return (root, query, cb) -> {
            if (search == null || search.isBlank()) {
                return null;
            }
            String pattern = "%" + escapeLike(search.trim().toLowerCase(Locale.ROOT)) + "%";
            return cb.or(
                    cb.like(cb.lower(root.get("email")), pattern, '\\'),
                    cb.like(cb.lower(root.get("firstName")), pattern, '\\'),
                    cb.like(cb.lower(root.get("lastName")), pattern, '\\'));
        };
    }

    public static Specification<User> hasStatus(UserStatus status) {
        return (root, query, cb) -> status == null ? null : cb.equal(root.get("status"), status);
    }

    public static Specification<User> hasRole(String roleName) {
        return (root, query, cb) -> {
            if (roleName == null || roleName.isBlank()) {
                return null;
            }
            query.distinct(true);
            Join<User, Role> roles = root.join("roles");
            return cb.equal(roles.get("name"), roleName);
        };
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
