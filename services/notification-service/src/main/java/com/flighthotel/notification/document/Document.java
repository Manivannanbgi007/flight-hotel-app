package com.flighthotel.notification.document;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * A generated PDF of a booking. The file itself lives in {@code FileStorage} under a key derived from the id; the id is
 * derived from (type, source), so the same document is never made twice.
 */
@Getter
@Entity
@Table(name = "documents")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Document implements Persistable<UUID> {

    public enum Type {
        BOOKING_CONFIRMATION("Booking confirmation", "confirmation"),
        E_TICKET("E-ticket", "e-ticket"),
        INVOICE("Tax invoice", "invoice"),
        PAYMENT_RECEIPT("Payment receipt", "payment-receipt"),
        CANCELLATION_CONFIRMATION("Cancellation confirmation", "cancellation"),
        REFUND_RECEIPT("Refund receipt", "refund-receipt");

        private final String title;
        private final String fileSuffix;

        Type(String title, String fileSuffix) {
            this.title = title;
            this.fileSuffix = fileSuffix;
        }

        public String title() {
            return title;
        }

        public String fileSuffix() {
            return fileSuffix;
        }
    }

    @Id
    private UUID id;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "document_type", nullable = false, updatable = false, length = 30)
    private Type type;

    @Column(name = "reference_id", nullable = false, updatable = false, length = 64)
    private String referenceId;

    @Column(nullable = false, updatable = false, length = 120)
    private String title;

    @Column(name = "file_name", nullable = false, updatable = false, length = 120)
    private String fileName;

    @Column(name = "storage_key", nullable = false, updatable = false, length = 120)
    private String storageKey;

    @Column(name = "content_type", nullable = false, updatable = false, length = 50)
    private String contentType;

    @Column(name = "size_bytes", nullable = false, updatable = false)
    private int sizeBytes;

    @Column(nullable = false, updatable = false, length = 64)
    private String sha256;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** The id of the document of this type for this source (booking, invoice, payment, cancellation, refund). */
    public static UUID idFor(Type type, String referenceId) {
        return UUID.nameUUIDFromBytes((type.name() + ":" + referenceId).getBytes(StandardCharsets.UTF_8));
    }

    public Document(Type type, String referenceId, UUID bookingId, UUID userId, String title, String fileName,
            String storageKey, int sizeBytes, String sha256, Instant createdAt) {
        this.id = idFor(type, referenceId);
        this.type = type;
        this.referenceId = referenceId;
        this.bookingId = bookingId;
        this.userId = userId;
        this.title = title;
        this.fileName = fileName;
        this.storageKey = storageKey;
        this.contentType = "application/pdf";
        this.sizeBytes = sizeBytes;
        this.sha256 = sha256;
        this.createdAt = createdAt;
    }

    @Transient
    private boolean isNew = true;

    @Override
    public boolean isNew() {
        return isNew;
    }

    @PostLoad
    @PostPersist
    void markNotNew() {
        this.isNew = false;
    }
}
