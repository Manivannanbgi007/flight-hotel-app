package com.flighthotel.common.security;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * Lets access tokens be revoked before they expire (they are otherwise valid for up to 15 minutes).
 * <ul>
 *   <li>{@link #revokeToken}: one token (logout of this session),</li>
 *   <li>{@link #revokeAllTokensIssuedBefore}: every token of a user issued before now (deactivation,
 *       password reset, "log out everywhere").</li>
 * </ul>
 * identity-service writes; every service checks through {@link TokenRevocationValidator}. Entries expire
 * automatically after the maximum access-token lifetime.
 */
public class TokenRevocationStore {

    private static final Logger log = LoggerFactory.getLogger(TokenRevocationStore.class);
    static final String JTI_PREFIX = "auth:revoked:jti:";
    static final String USER_PREFIX = "auth:revoked-before:";

    private final StringRedisTemplate redis;
    private final Duration maxTokenLifetime;
    private final Clock clock;

    public TokenRevocationStore(StringRedisTemplate redis, Duration maxTokenLifetime, Clock clock) {
        this.redis = redis;
        this.maxTokenLifetime = maxTokenLifetime;
        this.clock = clock;
    }

    public void revokeToken(String jti, Instant expiresAt) {
        Duration ttl = Duration.between(clock.instant(), expiresAt);
        if (jti == null || ttl.isNegative() || ttl.isZero()) {
            return;
        }
        redis.opsForValue().set(JTI_PREFIX + jti, "1", ttl);
    }

    public void revokeAllTokensIssuedBefore(UUID userId, Instant instant) {
        redis.opsForValue().set(USER_PREFIX + userId, String.valueOf(instant.getEpochSecond()),
                maxTokenLifetime.plusMinutes(1));
    }

    /** @return true if revoked. If Redis is unreachable the check is skipped (tokens are short-lived anyway). */
    public boolean isRevoked(String jti, String userId, Instant issuedAt) {
        try {
            if (jti != null && Boolean.TRUE.equals(redis.hasKey(JTI_PREFIX + jti))) {
                return true;
            }
            if (userId != null && issuedAt != null) {
                String before = redis.opsForValue().get(USER_PREFIX + userId);
                return before != null && issuedAt.getEpochSecond() < Long.parseLong(before);
            }
            return false;
        } catch (RuntimeException ex) {
            log.warn("Token revocation check skipped (Redis unavailable): {}", ex.toString());
            return false;
        }
    }
}
