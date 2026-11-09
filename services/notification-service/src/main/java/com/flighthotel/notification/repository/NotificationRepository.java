package com.flighthotel.notification.repository;

import java.time.Instant;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.notification.entity.Notification;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    Page<Notification> findByUserId(UUID userId, Pageable page);

    Page<Notification> findByUserIdAndReadAtIsNull(UUID userId, Pageable page);

    long countByUserIdAndReadAtIsNull(UUID userId);

    Page<Notification> findByUserIdAndCategory(UUID userId, String category, Pageable page);

    Page<Notification> findByUserIdAndCategoryAndReadAtIsNull(UUID userId, String category, Pageable page);

    boolean existsBySourceEventId(String sourceEventId);

    @Modifying
    @Query("update Notification n set n.readAt = :now where n.userId = :userId and n.readAt is null")
    int markAllRead(@Param("userId") UUID userId, @Param("now") Instant now);
}
