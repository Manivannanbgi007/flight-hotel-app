package com.flighthotel.identity.service.impl;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.web.ClientRequestInfo;
import com.flighthotel.identity.config.IdentityProperties;
import com.flighthotel.identity.entity.LoginHistory;
import com.flighthotel.identity.entity.User;
import com.flighthotel.identity.repository.LoginHistoryRepository;
import com.flighthotel.identity.repository.UserRepository;

/**
 * Records failed logins in their OWN transaction: the login itself fails (and rolls back), but the failed-attempt
 * counter and the login history entry must still be saved, otherwise the lockout would never trigger.
 */
@Component
public class LoginAttemptRecorder {

    private final UserRepository users;
    private final LoginHistoryRepository history;
    private final IdentityProperties properties;
    private final AuditPublisher audit;
    private final Clock clock;

    public LoginAttemptRecorder(UserRepository users, LoginHistoryRepository history, IdentityProperties properties,
            AuditPublisher audit, Clock clock) {
        this.users = users;
        this.history = history;
        this.properties = properties;
        this.audit = audit;
        this.clock = clock;
    }

    /** @return when the account is now locked until, or null if this failure did not lock it */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Instant recordFailure(UUID userId, String reason, boolean countTowardsLockout) {
        Instant now = clock.instant();
        Instant lockedUntil = null;
        if (countTowardsLockout) {
            User user = users.findById(userId).orElseThrow();
            if (user.recordFailedLogin(properties.login().maxFailedAttempts(), properties.login().lockoutDuration(), now)) {
                lockedUntil = user.getLockedUntil();
            }
        }
        history.save(new LoginHistory(userId, false, reason, ClientRequestInfo.ipAddress(),
                ClientRequestInfo.userAgent(), now));
        return lockedUntil;
    }

    /**
     * The right password on a sign-in page the account has no role for (Phase 11): a login history entry and an audit
     * entry, but no failed attempt (the user knows the password; lockout is for guessing).
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordPortalRefused(User user, String portal) {
        recordFailure(user.getId(), "PORTAL_NOT_ALLOWED", false);
        audit.record("LOGIN_PORTAL_REFUSED", "USER", user.getId().toString(),
                Map.of("portal", portal, "roles", String.join(",", user.roleNames().stream().sorted().toList())));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void recordSuccess(User user) {
        Instant now = clock.instant();
        user.recordSuccessfulLogin(now);
        history.save(new LoginHistory(user.getId(), true, null, ClientRequestInfo.ipAddress(),
                ClientRequestInfo.userAgent(), now));
    }
}
