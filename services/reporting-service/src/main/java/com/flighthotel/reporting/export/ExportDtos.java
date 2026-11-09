package com.flighthotel.reporting.export;

import java.time.Instant;

import com.flighthotel.reporting.export.ExportJob.Filters;
import com.flighthotel.reporting.export.ExportJob.Status;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Request and response bodies of the audit log exports (API_DOCUMENTATION.md section 11). */
public final class ExportDtos {

    private ExportDtos() {
    }

    /**
     * Every audit log entry matching these filters (the same as the list's), as Excel or CSV.
     *
     * @param exportedBy shown as "Exported by" in the file (the web app sends the admin's name; tokens carry none)
     */
    public record ExportRequest(
            @NotNull ExportFormat format,
            @Size(max = 60) String action,
            @Size(max = 40) String entityType,
            @Size(max = 64) String entityId,
            @Size(max = 64) String actorId,
            Instant from,
            Instant to,
            @Size(max = 200) String exportedBy) {
    }

    /** An export as its admin sees it; {@code totalRows} is null until the job has counted the entries. */
    public record ExportJobResponse(String id, ExportFormat format, Status status, Filters filters, Long totalRows,
            long rowsWritten, Integer parts, String fileName, Long sizeBytes, String error, Instant createdAt,
            Instant startedAt, Instant finishedAt, Instant expiresAt) {

        static ExportJobResponse of(ExportJob job) {
            return new ExportJobResponse(job.id().toString(), job.format(), job.status(), job.filters(),
                    job.totalRows(), job.rowsWritten(), job.parts(), job.fileName(), job.sizeBytes(), job.error(),
                    job.createdAt(), job.startedAt(), job.finishedAt(), job.expiresAt());
        }
    }

    /** A one-time download link: a same-origin path, valid until {@code expiresAt}. */
    public record ExportLinkResponse(String url, Instant expiresAt) {
    }
}
