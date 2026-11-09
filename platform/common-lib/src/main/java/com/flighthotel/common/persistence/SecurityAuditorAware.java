package com.flighthotel.common.persistence;

import java.util.Optional;

import org.springframework.data.domain.AuditorAware;

import com.flighthotel.common.security.CurrentUser;

/** Supplies the value for {@code created_by} / {@code updated_by}: the current user's ID, or {@code SYSTEM}. */
public class SecurityAuditorAware implements AuditorAware<String> {

    public static final String SYSTEM = "SYSTEM";

    @Override
    public Optional<String> getCurrentAuditor() {
        return Optional.of(CurrentUser.get().map(user -> user.id().toString()).orElse(SYSTEM));
    }
}
