package com.flighthotel.notification.ticket;

import java.time.Instant;
import java.util.UUID;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * A customer's support request (API_DOCUMENTATION.md section 10c). The status changes with each message: a customer reply
 * reopens a waiting or resolved ticket, a support reply waits for the customer; {@code CLOSED} is final.
 */
@Getter
@Entity
@Table(name = "support_tickets")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SupportTicket extends AuditableEntity {

    public enum Status { OPEN, IN_PROGRESS, WAITING_CUSTOMER, ESCALATED, RESOLVED, CLOSED }

    public enum Category { BOOKING, PAYMENT, REFUND, CANCELLATION, ACCOUNT, OTHER }

    @Id
    private UUID id;

    @Column(name = "ticket_number", nullable = false, updatable = false, length = 12)
    private String ticketNumber;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "customer_email", length = 254)
    private String customerEmail;

    @Column(name = "booking_id", updatable = false)
    private UUID bookingId;

    @Column(name = "booking_reference", updatable = false, length = 12)
    private String bookingReference;

    @Column(nullable = false, updatable = false, length = 120)
    private String subject;

    @jakarta.persistence.Enumerated(jakarta.persistence.EnumType.STRING)
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.VARCHAR)
    @Column(nullable = false, updatable = false, length = 20)
    private Category category;

    @jakarta.persistence.Enumerated(jakarta.persistence.EnumType.STRING)
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.VARCHAR)
    @Column(nullable = false, length = 20)
    private Status status;

    @Column(nullable = false, length = 10)
    private String priority;

    @Column(name = "assigned_agent_id")
    private UUID assignedAgentId;

    @Column(name = "assigned_at")
    private Instant assignedAt;

    @Column(name = "source_event_id", updatable = false, length = 36)
    private String sourceEventId;

    @Column(name = "last_message_at", nullable = false)
    private Instant lastMessageAt;

    @Column(name = "last_message_by", nullable = false, length = 20)
    private String lastMessageBy;

    @Column(name = "closed_at")
    private Instant closedAt;

    /** Phase 11: when the ticket was resolved or closed (the first of the two); null while it is open. */
    @Column(name = "resolved_at")
    private Instant resolvedAt;

    @Version
    private Long version;

    public record Opened(String ticketNumber, UUID userId, String customerEmail, UUID bookingId,
            String bookingReference, String subject, Category category, String priority, String sourceEventId) {
    }

    public static SupportTicket open(Opened opened, String openedBy, Instant now) {
        SupportTicket ticket = new SupportTicket();
        ticket.id = UuidV7.generate();
        ticket.ticketNumber = opened.ticketNumber();
        ticket.userId = opened.userId();
        ticket.customerEmail = opened.customerEmail();
        ticket.bookingId = opened.bookingId();
        ticket.bookingReference = opened.bookingReference();
        ticket.subject = opened.subject();
        ticket.category = opened.category();
        ticket.priority = opened.priority();
        ticket.sourceEventId = opened.sourceEventId();
        ticket.status = Status.OPEN;
        ticket.lastMessageAt = now;
        ticket.lastMessageBy = openedBy;
        return ticket;
    }

    public boolean isClosed() {
        return status == Status.CLOSED;
    }

    /** A message was added: a customer reply reopens the ticket, a support reply waits for the customer. */
    public void messageAdded(String by, Instant now) {
        lastMessageAt = now;
        lastMessageBy = by;
        if ("CUSTOMER".equals(by) && (status == Status.WAITING_CUSTOMER || status == Status.RESOLVED)) {
            status = Status.OPEN;
        } else if ("SUPPORT".equals(by)) {
            status = Status.WAITING_CUSTOMER;
        }
        resolved(now);
    }

    /** An agent takes the ticket (or hands it to a colleague); a new ticket is then "in progress". */
    public void assign(UUID agentId, Instant now) {
        assignedAgentId = agentId;
        assignedAt = now;
        if (status == Status.OPEN) {
            status = Status.IN_PROGRESS;
        }
    }

    /** Set by an agent (queue); {@code CLOSED} records when. */
    public void changeStatus(Status next, String newPriority, Instant now) {
        status = next;
        if (newPriority != null) {
            priority = newPriority;
        }
        closedAt = next == Status.CLOSED ? now : null;
        resolved(now);
    }

    public void close(Instant now) {
        status = Status.CLOSED;
        closedAt = now;
        resolved(now);
    }

    public boolean isResolved() {
        return status == Status.RESOLVED || status == Status.CLOSED;
    }

    /** Keeps {@link #resolvedAt} in line with the status: set once resolved or closed, cleared when reopened. */
    private void resolved(Instant now) {
        if (!isResolved()) {
            resolvedAt = null;
        } else if (resolvedAt == null) {
            resolvedAt = now;
        }
    }
}
