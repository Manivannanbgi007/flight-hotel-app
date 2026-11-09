package com.flighthotel.booking.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.id.UuidV7;

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

import org.springframework.data.domain.Persistable;

/** One row of the booking timeline (append-only). {@code from == to} records an event that kept the status. */
@Getter
@Entity
@Table(name = "booking_status_history")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class BookingStatusChange implements Persistable<UUID> {

    @Id
    private UUID id;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "from_status", length = 25, updatable = false)
    private BookingStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "to_status", nullable = false, length = 25, updatable = false)
    private BookingStatus toStatus;

    @Column(length = 255, updatable = false)
    private String reason;

    @Column(name = "changed_by", nullable = false, length = 64, updatable = false)
    private String changedBy;

    @Column(name = "caused_by_event_id", length = 36, updatable = false)
    private String causedByEventId;

    @Column(name = "changed_at", nullable = false, updatable = false)
    private Instant changedAt;

    public BookingStatusChange(UUID bookingId, BookingStatus fromStatus, BookingStatus toStatus, String reason,
            String changedBy, String causedByEventId, Instant changedAt) {
        this.id = UuidV7.generate();
        this.bookingId = bookingId;
        this.fromStatus = fromStatus;
        this.toStatus = toStatus;
        this.reason = reason == null || reason.length() <= 255 ? reason : reason.substring(0, 255);
        this.changedBy = changedBy;
        this.causedByEventId = causedByEventId;
        this.changedAt = changedAt;
    }

    /** Ids are assigned in Java, so Spring Data must be told when a row is new (no extra SELECT before INSERT). */
    @Transient
    private boolean isNew = true;

    @Override
    public boolean isNew() {
        return isNew;
    }

    @Override
    public UUID getId() {
        return id;
    }

    @PostLoad
    @PostPersist
    void markNotNew() {
        this.isNew = false;
    }
}
