package com.flighthotel.reporting.export;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.storage.FileStorage;
import com.flighthotel.reporting.audit.AuditLogStore;
import com.flighthotel.reporting.export.ExportDtos.ExportJobResponse;
import com.flighthotel.reporting.export.ExportDtos.ExportLinkResponse;
import com.flighthotel.reporting.export.ExportDtos.ExportRequest;
import com.flighthotel.reporting.export.ExportJob.Filters;
import com.flighthotel.reporting.export.ExportJob.Status;

/**
 * Background exports of the audit log (API_DOCUMENTATION.md section 11) for admins: every matching entry, any number,
 * as Excel (parts of up to a million rows) or CSV. {@link AuditExportRunner} writes the file; this class takes the
 * request, lists an admin's exports and hands out one-time download links. An admin only ever sees their own
 * exports; asking and downloading are recorded in the audit log.
 */
@Service
public class AuditExportService {

    /** Where a one-time link points (no login: the token is the permission). */
    public static final String FILE_PATH = "/api/public/export-files/";

    private static final Logger log = LoggerFactory.getLogger(AuditExportService.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final ExportJobStore jobs;
    private final AuditLogStore auditLogs;
    private final FileStorage storage;
    private final AuditPublisher audit;
    private final ExportProperties properties;
    private final Clock clock;

    public AuditExportService(ExportJobStore jobs, AuditLogStore auditLogs, FileStorage storage, AuditPublisher audit,
            ExportProperties properties, Clock clock) {
        this.jobs = jobs;
        this.auditLogs = auditLogs;
        this.storage = storage;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ExportJobResponse request(ExportRequest request) {
        AuthenticatedUser admin = CurrentUser.require();
        String requester = admin.id().toString();
        if (jobs.countUnfinished(requester) >= properties.maxActivePerAdmin()) {
            throw new ConflictException("EXPORT_LIMIT_REACHED", "You already have " + properties.maxActivePerAdmin()
                    + " exports in progress. Wait for one to finish, or cancel one.");
        }
        Instant now = clock.instant();
        Filters filters = new Filters(clean(request.action()), clean(request.entityType()),
                clean(request.entityId()), clean(request.actorId()), request.from(), request.to());
        if (!auditLogs.anyMatch(filters.toFilter(), now)) {
            throw new BusinessRuleException("EXPORT_EMPTY", "No audit log entries match these filters.");
        }
        ExportJob job = new ExportJob(UuidV7.generate(), request.format(), filters, now, requester,
                exportedBy(request.exportedBy(), admin), Status.QUEUED, null, 0, null, null, null, null, null, now,
                null, null, null);
        jobs.insert(job);
        Map<String, String> details = new LinkedHashMap<>();
        details.put("format", job.format().name());
        filterDetails(details, filters);
        audit.record("AUDIT_LOG_EXPORT_REQUESTED", "EXPORT", job.id().toString(), details);
        log.info("Audit log export requested exportId={} format={}", job.id(), job.format());
        return ExportJobResponse.of(job);
    }

    /** The admin's own exports of the last days, newest first. */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public List<ExportJobResponse> list() {
        String requester = CurrentUser.require().id().toString();
        return jobs.listFor(requester, clock.instant().minus(properties.listFor())).stream()
                .map(ExportJobResponse::of).toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public ExportJobResponse get(UUID id) {
        return ExportJobResponse.of(own(id));
    }

    /** Cancels a waiting or running export (it stops at its next batch), or removes a finished one and its file. */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public void remove(UUID id) {
        ExportJob job = own(id);
        jobs.delete(id);
        if (job.storageKey() != null) {
            deleteFile(job.storageKey());
        }
        log.info("Audit log export removed exportId={} status={}", id, job.status());
    }

    /**
     * A download link that works once, for {@link ExportProperties#linkLifetime()}: the browser's own download
     * manager then saves the file (it can be a gigabyte), which a request with the access token in a header could
     * not. Only a hash of the token is stored.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ExportLinkResponse link(UUID id) {
        ExportJob job = own(id);
        Instant now = clock.instant();
        if (job.status() != Status.READY || job.expiresAt() == null || !job.expiresAt().isAfter(now)) {
            throw new ConflictException("EXPORT_NOT_READY", "This export is not ready to download.");
        }
        byte[] random = new byte[32];
        RANDOM.nextBytes(random);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        Instant expiresAt = now.plus(properties.linkLifetime());
        jobs.setLink(id, sha256(token), expiresAt);
        Map<String, String> details = new LinkedHashMap<>();
        details.put("format", job.format().name());
        details.put("rows", String.valueOf(job.rowsWritten()));
        details.put("files", String.valueOf(job.parts()));
        audit.record("AUDIT_LOG_EXPORT_DOWNLOADED", "EXPORT", id.toString(), details);
        return new ExportLinkResponse(FILE_PATH + id + "?token=" + token, expiresAt);
    }

    /** The file behind a one-time link; any wrong, used or expired token is "not found". */
    @Transactional
    public Download download(UUID id, String token) {
        if (token == null || token.isBlank() || token.length() > 100
                || !jobs.useLink(id, sha256(token), clock.instant())) {
            throw new ResourceNotFoundException("Export file", id);
        }
        ExportJob job = jobs.find(id).orElseThrow(() -> new ResourceNotFoundException("Export file", id));
        FileStorage.StoredFile file = storage.open(job.storageKey())
                .orElseThrow(() -> new ResourceNotFoundException("Export file", id));
        log.info("Audit log export downloaded exportId={} bytes={}", id, file.size());
        return new Download(file, job.fileName(), contentType(job.fileName()));
    }

    public record Download(FileStorage.StoredFile file, String fileName, String contentType) {
    }

    static String contentType(String fileName) {
        if (fileName.endsWith(".zip")) {
            return ExportFileWriter.ZIP_TYPE;
        }
        return fileName.endsWith(".csv") ? StreamingCsvWriter.CONTENT_TYPE : StreamingXlsxWriter.CONTENT_TYPE;
    }

    /** One of the caller's exports; somebody else's is "not found" (not "forbidden"), like a missing one. */
    private ExportJob own(UUID id) {
        String requester = CurrentUser.require().id().toString();
        return jobs.find(id).filter(job -> job.requestedBy().equals(requester))
                .orElseThrow(() -> new ResourceNotFoundException("Export", id));
    }

    private void deleteFile(String key) {
        try {
            storage.delete(key);
        } catch (RuntimeException ex) {
            log.warn("Could not delete export file key={}", key, ex);
        }
    }

    private static void filterDetails(Map<String, String> details, Filters filters) {
        put(details, "action", filters.action());
        put(details, "entityType", filters.entityType());
        put(details, "entityId", filters.entityId());
        put(details, "actorId", filters.actorId());
        put(details, "from", filters.from() == null ? null : filters.from().toString());
        put(details, "to", filters.to() == null ? null : filters.to().toString());
    }

    private static void put(Map<String, String> details, String key, String value) {
        if (value != null) {
            details.put(key, value);
        }
    }

    private static String clean(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    /** The name the web app sent, without control characters; otherwise the admin's user id. */
    private static String exportedBy(String sent, AuthenticatedUser admin) {
        String cleaned = sent == null ? "" : sent.replaceAll("\\p{Cntrl}", " ").strip();
        return cleaned.isEmpty() ? "Admin (user " + admin.id() + ")" : cleaned;
    }

    static String sha256(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
