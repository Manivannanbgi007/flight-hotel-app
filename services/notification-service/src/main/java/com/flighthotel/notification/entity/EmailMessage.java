package com.flighthotel.notification.entity;

import java.time.Instant;
import java.util.UUID;

import com.flighthotel.common.id.UuidV7;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Log of an email we handled. The body is never stored (it may contain a single-use link). */
@Getter
@Entity
@Table(name = "email_messages")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class EmailMessage {

    @Id
    private UUID id;

    @Column(name = "source_event_id", nullable = false, length = 36)
    private String sourceEventId;

    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "to_email", nullable = false, length = 254)
    private String toEmail;

    @Column(nullable = false, length = 50)
    private String template;

    @Column(nullable = false)
    private String subject;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 20)
    private EmailStatus status;

    @Column(name = "sent_at")
    private Instant sentAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public EmailMessage(String sourceEventId, UUID userId, String toEmail, String template, String subject,
            EmailStatus status, Instant now) {
        this.id = UuidV7.generate();
        this.sourceEventId = sourceEventId;
        this.userId = userId;
        this.toEmail = toEmail;
        this.template = template;
        this.subject = subject;
        this.status = status;
        this.sentAt = status == EmailStatus.SENT ? now : null;
        this.createdAt = now;
    }

    public enum EmailStatus {
        SENT,
        /** The link in the email had already expired when the request arrived (e.g. after an outage). */
        SKIPPED_EXPIRED
    }
}
