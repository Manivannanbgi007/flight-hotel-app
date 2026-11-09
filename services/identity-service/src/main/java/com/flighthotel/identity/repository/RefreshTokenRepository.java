package com.flighthotel.identity.repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.identity.entity.RefreshToken;
import com.flighthotel.identity.entity.RevokeReason;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    /** Row lock: two refreshes with the same token are processed one after the other, never in parallel. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from RefreshToken t where t.tokenHash = :hash")
    Optional<RefreshToken> findByTokenHashForUpdate(@Param("hash") String hash);

    @Modifying
    @Query("""
            update RefreshToken t set t.revokedAt = :now, t.revokeReason = :reason
            where t.familyId = :familyId and t.revokedAt is null""")
    int revokeFamily(@Param("familyId") UUID familyId, @Param("reason") RevokeReason reason, @Param("now") Instant now);

    @Modifying
    @Query("""
            update RefreshToken t set t.revokedAt = :now, t.revokeReason = :reason
            where t.userId = :userId and t.revokedAt is null""")
    int revokeAllForUser(@Param("userId") UUID userId, @Param("reason") RevokeReason reason, @Param("now") Instant now);

    @Modifying
    @Query("""
            update RefreshToken t set t.revokedAt = :now, t.revokeReason = :reason
            where t.userId = :userId and t.familyId <> :keepFamilyId and t.revokedAt is null""")
    int revokeAllForUserExceptFamily(@Param("userId") UUID userId, @Param("keepFamilyId") UUID keepFamilyId,
            @Param("reason") RevokeReason reason, @Param("now") Instant now);

    @Modifying
    @Query("delete from RefreshToken t where t.expiresAt < :cutoff")
    int deleteExpiredBefore(@Param("cutoff") Instant cutoff);
}
