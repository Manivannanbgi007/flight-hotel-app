package com.flighthotel.identity.repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.identity.entity.EmailVerificationToken;

public interface EmailVerificationTokenRepository extends JpaRepository<EmailVerificationToken, UUID> {

    Optional<EmailVerificationToken> findByTokenHash(String tokenHash);

    Optional<EmailVerificationToken> findFirstByUserIdOrderByCreatedAtDesc(UUID userId);

    @Modifying
    @Query("update EmailVerificationToken t set t.usedAt = :now where t.userId = :userId and t.usedAt is null")
    int invalidateAllForUser(@Param("userId") UUID userId, @Param("now") Instant now);

    @Modifying
    @Query("delete from EmailVerificationToken t where t.expiresAt < :cutoff")
    int deleteExpiredBefore(@Param("cutoff") Instant cutoff);
}
