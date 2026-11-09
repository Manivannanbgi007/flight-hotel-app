package com.flighthotel.booking.entity;

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
 * An internal note of the support team on a booking (escalated, resolved, refund retried, ...). Visible to support
 * agents and admins only; never on the customer's timeline.
 */
@Getter
@Entity
@Table(name = "booking_support_notes")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SupportNote {

    @Id
    private UUID id;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(nullable = false, updatable = false, length = 30)
    private String action;

    @Column(length = 500, updatable = false)
    private String note;

    @Column(name = "author_id", nullable = false, updatable = false, length = 64)
    private String authorId;

    @Column(name = "author_role", nullable = false, updatable = false, length = 20)
    private String authorRole;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public SupportNote(UUID bookingId, String action, String note, String authorId, String authorRole,
            Instant createdAt) {
        this.id = UuidV7.generate();
        this.bookingId = bookingId;
        this.action = action;
        this.note = note == null || note.length() <= 500 ? note : note.substring(0, 500);
        this.authorId = authorId;
        this.authorRole = authorRole;
        this.createdAt = createdAt;
    }
}
