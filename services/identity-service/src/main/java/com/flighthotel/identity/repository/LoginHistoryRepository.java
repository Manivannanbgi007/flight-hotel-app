package com.flighthotel.identity.repository;

import java.time.Instant;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.identity.entity.LoginHistory;

public interface LoginHistoryRepository extends JpaRepository<LoginHistory, UUID> {

    Page<LoginHistory> findByUserIdOrderByOccurredAtDesc(UUID userId, Pageable pageable);

    @Modifying
    @Query("delete from LoginHistory h where h.occurredAt < :cutoff")
    int deleteOlderThan(@Param("cutoff") Instant cutoff);
}
