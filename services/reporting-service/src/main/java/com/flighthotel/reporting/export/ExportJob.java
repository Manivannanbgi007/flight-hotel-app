package com.flighthotel.reporting.export;

import java.time.Instant;
import java.util.UUID;

import com.flighthotel.reporting.audit.AuditLogStore;

/**
 * A background export. Status: {@code QUEUED} → {@code RUNNING} → {@code READY} (file stored, downloadable until
 * {@code expiresAt}) → {@code EXPIRED} (file deleted); or {@code FAILED}. Removing a job (the admin's "Cancel" or
 * "Remove") deletes it and its file; a running export stops at its next batch.
 */
public record ExportJob(UUID id, ExportFormat format, Filters filters, Instant asOf, String requestedBy,
        String requestedByName, Status status, Long totalRows, long rowsWritten, Integer parts, String storageKey,
        String fileName, Long sizeBytes, String error, Instant createdAt, Instant startedAt, Instant finishedAt,
        Instant expiresAt) {

    public enum Status { QUEUED, RUNNING, READY, FAILED, EXPIRED }

    /** The audit log filters of the export (exact matches; {@code from} inclusive, {@code to} exclusive). */
    public record Filters(String action, String entityType, String entityId, String actorId, Instant from,
            Instant to) {

        AuditLogStore.Filter toFilter() {
            return new AuditLogStore.Filter(action, entityType, entityId, actorId, from, to);
        }
    }
}
