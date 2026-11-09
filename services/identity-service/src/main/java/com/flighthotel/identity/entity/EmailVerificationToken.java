package com.flighthotel.identity.entity;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import com.flighthotel.common.id.UuidV7;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** Single-use token from the "verify your email" link. Only the hash is stored. */
@Getter
@Entity
@Table(name = "email_verification_tokens")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class EmailVerificationToken {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "used_at")
    private Instant usedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public EmailVerificationToken(UUID userId, String tokenHash, Instant expiresAt, Instant now) {
        this.id = UuidV7.generate();
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.createdAt = now;
    }

    public boolean isUsable(Instant now) {
        return usedAt == null && now.isBefore(expiresAt);
    }

    public void markUsed(Instant now) {
        if (usedAt == null) {
            usedAt = now;
        }
    }
}
