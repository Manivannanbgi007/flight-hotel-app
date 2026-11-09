package com.flighthotel.hotel.entity;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * A guest's review of one completed stay (API_DOCUMENTATION.md §14.4). One per booking; it starts PENDING and is
 * public only once a moderator approved it. The author's display name and the stay date are copied when the review
 * is written, so the public page never needs the author's account.
 */
@Getter
@Entity
@Table(name = "reviews")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Review extends AuditableEntity {

    @Id
    private UUID id;

    @Column(name = "hotel_id", nullable = false, updatable = false)
    private UUID hotelId;

    @Column(name = "reservation_id", nullable = false, updatable = false)
    private UUID reservationId;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(name = "booking_reference", nullable = false, updatable = false, length = 20)
    private String bookingReference;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "author_name", nullable = false, updatable = false, length = 80)
    private String authorName;

    @Column(name = "stayed_on", nullable = false, updatable = false)
    private LocalDate stayedOn;

    @Column(nullable = false, updatable = false)
    private int rating;

    @Column(nullable = false, updatable = false, length = 100)
    private String title;

    @Column(name = "body", nullable = false, updatable = false, columnDefinition = "TEXT")
    private String text;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 10)
    private ReviewStatus status;

    @Column(name = "rejection_reason", length = 300)
    private String rejectionReason;

    @Column(name = "moderated_at")
    private Instant moderatedAt;

    @Column(name = "moderated_by", length = 64)
    private String moderatedBy;

    @Version
    private Long version;

    /** A new review of the stay, waiting for moderation. */
    public static Review submit(HotelReservation stay, String authorName, int rating, String title, String text) {
        Review review = new Review();
        review.id = UuidV7.generate();
        review.hotelId = stay.getHotelId();
        review.reservationId = stay.getId();
        review.bookingId = stay.getBookingId();
        review.bookingReference = stay.getBookingReference();
        review.userId = stay.getUserId();
        review.authorName = authorName;
        review.stayedOn = stay.getCheckIn();
        review.rating = rating;
        review.title = title;
        review.text = text;
        review.status = ReviewStatus.PENDING;
        return review;
    }

    /** Published (also used to keep an approved review after it was reported). */
    public void approve(String moderator, Instant now) {
        status = ReviewStatus.APPROVED;
        rejectionReason = null;
        moderatedAt = now;
        moderatedBy = moderator;
    }

    /** Not (or no longer) published; the author sees the reason. */
    public void reject(String reason, String moderator, Instant now) {
        status = ReviewStatus.REJECTED;
        rejectionReason = reason;
        moderatedAt = now;
        moderatedBy = moderator;
    }

    public boolean isApproved() {
        return status == ReviewStatus.APPROVED;
    }

    public boolean isWrittenBy(UUID user) {
        return userId.equals(user);
    }
}
