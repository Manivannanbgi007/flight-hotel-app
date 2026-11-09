package com.flighthotel.notification.entity;

import java.time.Instant;
import java.util.UUID;

import com.flighthotel.common.id.UuidV7;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** One in-app notification of a customer. */
@Getter
@Entity
@Table(name = "notifications")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Notification {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(nullable = false, updatable = false, length = 20)
    private String category;

    @Column(nullable = false, updatable = false, length = 150)
    private String title;

    @Column(nullable = false, updatable = false, length = 500)
    private String message;

    @Column(updatable = false, length = 200)
    private String link;

    @Column(name = "source_event_id", nullable = false, updatable = false, length = 64)
    private String sourceEventId;

    @Column(name = "read_at")
    private Instant readAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public Notification(UUID userId, String category, String title, String message, String link,
            String sourceEventId, Instant now) {
        this.id = UuidV7.generate();
        this.userId = userId;
        this.category = category;
        this.title = title.length() > 150 ? title.substring(0, 150) : title;
        this.message = message.length() > 500 ? message.substring(0, 500) : message;
        this.link = link;
        this.sourceEventId = sourceEventId;
        this.createdAt = now;
    }

    public void markUnread() {
        this.readAt = null;
    }

    public void markRead(Instant now) {
        if (readAt == null) {
            this.readAt = now;
        }
    }
}
