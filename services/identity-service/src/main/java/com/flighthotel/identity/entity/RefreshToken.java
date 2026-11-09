package com.flighthotel.identity.entity;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.id.UuidV7;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * One refresh token. Every refresh replaces the token with a new one in the same {@code familyId} (one family =
 * one login session). Only the SHA-256 hash of the token is stored.
 */
@Getter
@Entity
@Table(name = "refresh_tokens")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RefreshToken {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(name = "remember_me", nullable = false)
    private boolean rememberMe;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "revoke_reason", length = 30)
    private RevokeReason revokeReason;

    @Column(name = "replaced_by_id")
    private UUID replacedById;

    @Column(name = "ip_address", length = 45)
    private String ipAddress;

    @Column(name = "user_agent")
    private String userAgent;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public RefreshToken(UUID userId, UUID familyId, String tokenHash, boolean rememberMe, Instant expiresAt,
            String ipAddress, String userAgent, Instant now) {
        this.id = UuidV7.generate();
        this.userId = userId;
        this.familyId = familyId;
        this.tokenHash = tokenHash;
        this.rememberMe = rememberMe;
        this.expiresAt = expiresAt;
        this.ipAddress = ipAddress;
        this.userAgent = userAgent;
        this.createdAt = now;
    }

    public boolean isActive(Instant now) {
        return revokedAt == null && now.isBefore(expiresAt);
    }

    public void rotatedTo(UUID successorId, Instant now) {
        revokedAt = now;
        revokeReason = RevokeReason.ROTATED;
        replacedById = successorId;
    }

    public void revoke(RevokeReason reason, Instant now) {
        if (revokedAt == null) {
            revokedAt = now;
            revokeReason = reason;
        }
    }

    /** A just-rotated token used again within the grace period: several tabs refreshing at the same moment. */
    public boolean wasRotatedWithin(Duration grace, Instant now) {
        return revokeReason == RevokeReason.ROTATED && revokedAt != null && !now.isAfter(revokedAt.plus(grace));
    }
}
