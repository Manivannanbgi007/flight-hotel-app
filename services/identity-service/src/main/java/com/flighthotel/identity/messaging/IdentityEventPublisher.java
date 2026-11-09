package com.flighthotel.identity.messaging;

import java.time.Clock;
import java.time.Instant;
import java.util.List;

import org.springframework.stereotype.Component;

import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.events.identity.AuthEmailRequested;
import com.flighthotel.events.identity.EmailVerified;
import com.flighthotel.events.identity.UserProfileUpdated;
import com.flighthotel.events.identity.UserRegistered;
import com.flighthotel.events.identity.UserSnapshot;
import com.flighthotel.events.identity.UserRolesChanged;
import com.flighthotel.events.identity.UserStatusChanged;
import com.flighthotel.identity.entity.User;
import com.flighthotel.identity.security.Portal;

/**
 * Publishes identity events through the outbox (must be called inside a transaction).
 * <ul>
 *   <li>{@code identity.events}: account facts other services keep copies of (long retention, no secrets).</li>
 *   <li>{@code identity-email.events}: "please send this email" requests. They contain single-use tokens, so this
 *       topic keeps messages for 24 hours only.</li>
 * </ul>
 */
@Component
public class IdentityEventPublisher {

    static final String USER_EVENTS = "identity";
    static final String EMAIL_EVENTS = "identity-email";

    private final OutboxEventPublisher outbox;
    private final Clock clock;

    public IdentityEventPublisher(OutboxEventPublisher outbox, Clock clock) {
        this.outbox = outbox;
        this.clock = clock;
    }

    /** The account as it is now (the one-time backfill for read models that start later). */
    public void userSnapshot(User user) {
        outbox.publish(USER_EVENTS, user.getId().toString(), UserSnapshot.newBuilder()
                .setUserId(user.getId().toString())
                .setEmail(user.getEmail())
                .setFirstName(user.getFirstName())
                .setLastName(user.getLastName())
                .setRoles(List.copyOf(user.roleNames()))
                .setStatus(user.getStatus().name())
                .setEmailVerified(user.isEmailVerified())
                .setRegisteredAt(user.getCreatedAt())
                .setSnapshotAt(clock.instant())
                .build());
    }

    public void userRegistered(User user) {
        outbox.publish(USER_EVENTS, user.getId().toString(), UserRegistered.newBuilder()
                .setUserId(user.getId().toString())
                .setEmail(user.getEmail())
                .setFirstName(user.getFirstName())
                .setLastName(user.getLastName())
                .setRoles(List.copyOf(user.roleNames()))
                .setStatus(user.getStatus().name())
                .setRegisteredAt(clock.instant())
                .build());
    }

    public void emailVerified(User user) {
        outbox.publish(USER_EVENTS, user.getId().toString(), EmailVerified.newBuilder()
                .setUserId(user.getId().toString())
                .setEmail(user.getEmail())
                .setFirstName(user.getFirstName())
                .setVerifiedAt(clock.instant())
                .build());
    }

    public void profileUpdated(User user) {
        outbox.publish(USER_EVENTS, user.getId().toString(), UserProfileUpdated.newBuilder()
                .setUserId(user.getId().toString())
                .setEmail(user.getEmail())
                .setFirstName(user.getFirstName())
                .setLastName(user.getLastName())
                .setPhone(user.getPhone())
                .setUpdatedAt(clock.instant())
                .build());
    }

    public void statusChanged(User user, String reason, String changedBy) {
        outbox.publish(USER_EVENTS, user.getId().toString(), UserStatusChanged.newBuilder()
                .setUserId(user.getId().toString())
                .setStatus(user.getStatus().name())
                .setReason(reason)
                .setChangedBy(changedBy)
                .setChangedAt(clock.instant())
                .build());
    }

    public void rolesChanged(User user, String changedBy) {
        outbox.publish(USER_EVENTS, user.getId().toString(), UserRolesChanged.newBuilder()
                .setUserId(user.getId().toString())
                .setRoles(List.copyOf(user.roleNames()))
                .setChangedBy(changedBy)
                .setChangedAt(clock.instant())
                .build());
    }

    /** @param token single-use token for link emails, or null */
    public void requestEmail(User user, AuthEmailType type, String token, Instant expiresAt) {
        outbox.publish(EMAIL_EVENTS, user.getId().toString(), AuthEmailRequested.newBuilder()
                .setUserId(user.getId().toString())
                .setEmail(user.getEmail())
                .setFirstName(user.getFirstName())
                .setEmailType(type.name())
                .setToken(token)
                .setExpiresAt(expiresAt)
                .setRequestedAt(clock.instant())
                .setPortal(type == AuthEmailType.ACCOUNT_INVITATION ? Portal.invitationSignIn(user.roleNames()) : null)
                .build());
    }

    public enum AuthEmailType {
        VERIFY_EMAIL, RESET_PASSWORD, ACCOUNT_INVITATION, PASSWORD_CHANGED, ACCOUNT_EXISTS, WELCOME
    }
}
