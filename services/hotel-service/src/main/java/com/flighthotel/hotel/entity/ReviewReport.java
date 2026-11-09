package com.flighthotel.hotel.entity;

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

/**
 * "This review is inappropriate", from one user (once per review). OPEN reports put the review in the moderation
 * queue; the moderator's decision on the review closes them.
 */
@Getter
@Entity
@Table(name = "review_reports")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ReviewReport {

    public static final String OPEN = "OPEN";
    public static final String CLOSED = "CLOSED";

    @Id
    private UUID id;

    @Column(name = "review_id", nullable = false, updatable = false)
    private UUID reviewId;

    @Column(name = "reporter_id", nullable = false, updatable = false)
    private UUID reporterId;

    @Column(nullable = false, updatable = false, length = 300)
    private String reason;

    @Column(nullable = false, length = 10)
    private String status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "closed_at")
    private Instant closedAt;

    public ReviewReport(UUID reviewId, UUID reporterId, String reason, Instant now) {
        this.id = UuidV7.generate();
        this.reviewId = reviewId;
        this.reporterId = reporterId;
        this.reason = reason;
        this.status = OPEN;
        this.createdAt = now;
    }
}
