package com.flighthotel.payment.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.id.UuidV7;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** A signed webhook we accepted. The unique provider event id makes a repeated delivery a no-op. */
@Getter
@Entity
@Table(name = "payment_webhook_events")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class WebhookEvent {

    public static final String PROCESSED = "PROCESSED";
    public static final String IGNORED = "IGNORED";

    @Id
    private UUID id;

    @Column(nullable = false, updatable = false, length = 10)
    private String provider;

    @Column(name = "provider_event_id", nullable = false, updatable = false, length = 100)
    private String providerEventId;

    @Column(name = "event_type", nullable = false, updatable = false, length = 50)
    private String eventType;

    /** Ids, amounts and status only (JSON text). */
    @JdbcTypeCode(SqlTypes.JSON)
    private String summary;

    @Column(name = "processing_status", nullable = false, length = 20)
    private String processingStatus;

    @Column(name = "received_at", nullable = false, updatable = false)
    private Instant receivedAt;

    @Column(name = "processed_at")
    private Instant processedAt;

    public WebhookEvent(String provider, String providerEventId, String eventType, String summary, Instant now) {
        this.id = UuidV7.generate();
        this.provider = provider;
        this.providerEventId = providerEventId;
        this.eventType = eventType.length() > 50 ? eventType.substring(0, 50) : eventType;
        this.summary = summary;
        this.processingStatus = "RECEIVED";
        this.receivedAt = now;
    }

    public void done(String status, Instant now) {
        this.processingStatus = status;
        this.processedAt = now;
    }
}
