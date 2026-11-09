package com.flighthotel.identity.service.impl;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.TokenRevocationStore;
import com.flighthotel.common.web.ClientRequestInfo;
import com.flighthotel.identity.config.IdentityProperties;
import com.flighthotel.identity.entity.RefreshToken;
import com.flighthotel.identity.entity.RevokeReason;
import com.flighthotel.identity.exception.IdentityErrors.SessionExpiredException;
import com.flighthotel.identity.repository.RefreshTokenRepository;
import com.flighthotel.identity.security.SecureTokens;

/**
 * Login sessions = refresh-token families.
 * <p>
 * Every refresh rotates the token. If an already-rotated token is used again <b>after</b> the short grace period,
 * someone is replaying a stolen token: the whole family is revoked and the real user must log in again.
 */
@Service
public class SessionService {

    private static final Logger log = LoggerFactory.getLogger(SessionService.class);

    private final RefreshTokenRepository refreshTokens;
    private final TokenRevocationStore revocationStore;
    private final RealtimePublisher realtime;
    private final AuditPublisher audit;
    private final IdentityProperties properties;
    private final Clock clock;

    public SessionService(RefreshTokenRepository refreshTokens, TokenRevocationStore revocationStore,
            RealtimePublisher realtime, AuditPublisher audit, IdentityProperties properties, Clock clock) {
        this.refreshTokens = refreshTokens;
        this.revocationStore = revocationStore;
        this.realtime = realtime;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    /** Starts a new session (login). */
    @Transactional(propagation = Propagation.MANDATORY)
    public NewRefreshToken start(UUID userId, boolean rememberMe) {
        return issue(userId, UuidV7.generate(), rememberMe, clock.instant());
    }

    /**
     * Exchanges a refresh token for a new one. Commits even when it throws, so a detected token reuse
     * really revokes the family.
     */
    @Transactional(noRollbackFor = SessionExpiredException.class)
    public RefreshOutcome rotate(String rawToken) {
        Instant now = clock.instant();
        RefreshToken token = refreshTokens.findByTokenHashForUpdate(SecureTokens.sha256Hex(rawToken))
                .orElseThrow(SessionExpiredException::new);

        if (token.isActive(now)) {
            NewRefreshToken successor = issue(token.getUserId(), token.getFamilyId(), token.isRememberMe(), now);
            token.rotatedTo(successor.id(), now);
            return new RefreshOutcome(token.getUserId(), token.getFamilyId(), successor);
        }

        if (token.wasRotatedWithin(properties.tokens().refreshReuseGrace(), now)) {
            // Another tab refreshed a moment ago and the browser already holds the new cookie.
            RefreshToken successor = refreshTokens.findById(token.getReplacedById()).orElse(null);
            if (successor != null && successor.isActive(now)) {
                return new RefreshOutcome(token.getUserId(), token.getFamilyId(), null);
            }
        }

        if (token.getRevokeReason() == RevokeReason.ROTATED) {
            int revoked = refreshTokens.revokeFamily(token.getFamilyId(), RevokeReason.REUSE_DETECTED, now);
            log.warn("Refresh token reuse detected; session revoked userId={} familyId={} tokensRevoked={}",
                    token.getUserId(), token.getFamilyId(), revoked);
            audit.record("SESSION_REUSE_DETECTED", "USER", token.getUserId().toString(),
                    Map.of("familyId", token.getFamilyId().toString()));
        }
        throw new SessionExpiredException();
    }

    /** Logout of one session. Unknown or already revoked tokens are ignored. */
    @Transactional
    public void end(String rawToken) {
        refreshTokens.findByTokenHashForUpdate(SecureTokens.sha256Hex(rawToken))
                .ifPresent(token -> refreshTokens.revokeFamily(token.getFamilyId(), RevokeReason.LOGOUT, clock.instant()));
    }

    /**
     * Ends every session of the user, including access tokens that are still valid, and tells open browser tabs
     * to log out (realtime {@code session.revoked}).
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void endAll(UUID userId, RevokeReason reason) {
        Instant now = clock.instant();
        refreshTokens.revokeAllForUser(userId, reason, now);
        // +1 s: also kills a token issued in this very second (JWT times are whole seconds).
        afterCommit(() -> revocationStore.revokeAllTokensIssuedBefore(userId, now.plusSeconds(1)));
        realtime.publish(RealtimeMessage.of("session.revoked", "USER", userId.toString(), Map.of("reason", reason.name())),
                RealtimeAudience.user(userId));
    }

    /** Ends all other sessions (after a password change); the current one gets a fresh access token. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void endAllExcept(UUID userId, UUID keepSessionId, RevokeReason reason) {
        Instant now = clock.instant();
        refreshTokens.revokeAllForUserExceptFamily(userId, keepSessionId, reason, now);
        afterCommit(() -> revocationStore.revokeAllTokensIssuedBefore(userId, now));
    }

    /**
     * Invalidates the user's current access tokens but keeps the sessions: the browser gets a 401, refreshes, and
     * receives a token with the new roles (used after a role change).
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void invalidateAccessTokens(UUID userId) {
        Instant now = clock.instant();
        // +1 s like endAll: a demoted user must not keep a token from this very second. A refresh within the same
        // second also gets a revoked token; the client's next refresh succeeds.
        afterCommit(() -> revocationStore.revokeAllTokensIssuedBefore(userId, now.plusSeconds(1)));
    }

    public void revokeAccessToken(String jti, Instant expiresAt) {
        revocationStore.revokeToken(jti, expiresAt);
    }

    private NewRefreshToken issue(UUID userId, UUID familyId, boolean rememberMe, Instant now) {
        Duration ttl = rememberMe ? properties.tokens().rememberMeTtl() : properties.tokens().refreshTokenTtl();
        String raw = SecureTokens.generate();
        RefreshToken token = new RefreshToken(userId, familyId, SecureTokens.sha256Hex(raw), rememberMe,
                now.plus(ttl), ClientRequestInfo.ipAddress(), ClientRequestInfo.userAgent(), now);
        refreshTokens.save(token);
        return new NewRefreshToken(token.getId(), raw, familyId, rememberMe, ttl);
    }

    private static void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }

    /** @param ttl cookie lifetime; a non-"remember me" token becomes a session cookie */
    public record NewRefreshToken(UUID id, String rawToken, UUID familyId, boolean rememberMe, Duration ttl) {
    }

    /** @param newToken null when the request was a harmless concurrent refresh (no new cookie needed) */
    public record RefreshOutcome(UUID userId, UUID familyId, NewRefreshToken newToken) {
    }
}
