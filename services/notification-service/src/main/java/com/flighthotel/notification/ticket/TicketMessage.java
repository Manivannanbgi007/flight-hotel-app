package com.flighthotel.notification.ticket;

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

/** One message of a support ticket conversation; messages are never edited. */
@Getter
@Entity
@Table(name = "support_ticket_messages")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TicketMessage {

    @Id
    private UUID id;

    @Column(name = "ticket_id", nullable = false, updatable = false)
    private UUID ticketId;

    @Column(name = "author_id", nullable = false, updatable = false, length = 64)
    private String authorId;

    @Column(name = "author_role", nullable = false, updatable = false, length = 20)
    private String authorRole;

    @Column(nullable = false, updatable = false, length = 2000)
    private String message;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public TicketMessage(UUID ticketId, String authorId, String authorRole, String message, Instant createdAt) {
        this.id = UuidV7.generate();
        this.ticketId = ticketId;
        this.authorId = authorId;
        this.authorRole = authorRole;
        this.message = message;
        this.createdAt = createdAt;
    }
}
