package com.flighthotel.reporting.export;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.flighthotel.reporting.export.ExportJob.Filters;
import com.flighthotel.reporting.export.ExportJob.Status;

import tools.jackson.databind.json.JsonMapper;

/**
 * The {@code export_jobs} table. Every change of status is one conditional UPDATE, so two instances never run the
 * same job, and a job removed by its admin is never brought back (its updates find no row).
 */
@Repository
public class ExportJobStore {

    private static final String COLUMNS = "BIN_TO_UUID(id) AS id, format, filters, as_of, requested_by, "
            + "requested_by_name, status, total_rows, rows_written, parts, storage_key, file_name, size_bytes, error, "
            + "created_at, started_at, finished_at, expires_at";

    private final JdbcClient jdbc;
    private final JsonMapper json;

    public ExportJobStore(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    void insert(ExportJob job) {
        jdbc.sql("INSERT INTO export_jobs (id, dataset, format, filters, as_of, requested_by, requested_by_name, "
                        + "status, created_at) VALUES (UUID_TO_BIN(:id), 'AUDIT_LOGS', :format, :filters, :asOf, "
                        + ":requestedBy, :requestedByName, 'QUEUED', :createdAt)")
                .param("id", job.id().toString())
                .param("format", job.format().name())
                .param("filters", json.writeValueAsString(job.filters()))
                .param("asOf", utc(job.asOf()))
                .param("requestedBy", job.requestedBy())
                .param("requestedByName", job.requestedByName())
                .param("createdAt", utc(job.createdAt()))
                .update();
    }

    Optional<ExportJob> find(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM export_jobs WHERE id = UUID_TO_BIN(:id)")
                .param("id", id.toString()).query((rs, i) -> job(rs)).optional();
    }

    /** One admin's jobs since a time, newest first. */
    List<ExportJob> listFor(String requestedBy, Instant since) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM export_jobs WHERE requested_by = :requestedBy "
                        + "AND created_at >= :since ORDER BY created_at DESC, id DESC")
                .param("requestedBy", requestedBy).param("since", utc(since)).query((rs, i) -> job(rs)).list();
    }

    int countUnfinished(String requestedBy) {
        return jdbc.sql("SELECT COUNT(*) FROM export_jobs WHERE requested_by = :requestedBy "
                        + "AND status IN ('QUEUED', 'RUNNING')")
                .param("requestedBy", requestedBy).query(Integer.class).single();
    }

    /** Waiting jobs, oldest first. */
    List<UUID> queued(int limit) {
        return jdbc.sql("SELECT BIN_TO_UUID(id) FROM export_jobs WHERE status = 'QUEUED' ORDER BY created_at, id "
                        + "LIMIT :limit")
                .param("limit", limit).query(String.class).list().stream().map(UUID::fromString).toList();
    }

    /** @return true for the one instance that gets to run the job */
    boolean claim(UUID id, Instant now) {
        return jdbc.sql("UPDATE export_jobs SET status = 'RUNNING', started_at = :now, heartbeat_at = :now, "
                        + "rows_written = 0 WHERE id = UUID_TO_BIN(:id) AND status = 'QUEUED'")
                .param("id", id.toString()).param("now", utc(now)).update() == 1;
    }

    /** @return false when the job was removed meanwhile */
    boolean counted(UUID id, long totalRows, int parts, Instant now) {
        return jdbc.sql("UPDATE export_jobs SET total_rows = :total, parts = :parts, heartbeat_at = :now "
                        + "WHERE id = UUID_TO_BIN(:id) AND status = 'RUNNING'")
                .param("id", id.toString()).param("total", totalRows).param("parts", parts).param("now", utc(now))
                .update() == 1;
    }

    /** @return false when the job was removed meanwhile: the export stops */
    boolean progress(UUID id, long rowsWritten, Instant now) {
        return jdbc.sql("UPDATE export_jobs SET rows_written = :rows, heartbeat_at = :now "
                        + "WHERE id = UUID_TO_BIN(:id) AND status = 'RUNNING'")
                .param("id", id.toString()).param("rows", rowsWritten).param("now", utc(now)).update() == 1;
    }

    /** @return false when the job was removed meanwhile (the caller deletes the stored file) */
    boolean ready(UUID id, String storageKey, String fileName, long sizeBytes, long rows, int parts, Instant now,
            Instant expiresAt) {
        return jdbc.sql("UPDATE export_jobs SET status = 'READY', storage_key = :key, file_name = :fileName, "
                        + "size_bytes = :size, rows_written = :rows, total_rows = :rows, parts = :parts, "
                        + "finished_at = :now, heartbeat_at = :now, expires_at = :expiresAt "
                        + "WHERE id = UUID_TO_BIN(:id) AND status = 'RUNNING'")
                .param("id", id.toString()).param("key", storageKey).param("fileName", fileName)
                .param("size", sizeBytes).param("rows", rows).param("parts", parts).param("now", utc(now))
                .param("expiresAt", utc(expiresAt)).update() == 1;
    }

    /** @param error safe to show to the admin */
    boolean fail(UUID id, String error, Instant now) {
        return jdbc.sql("UPDATE export_jobs SET status = 'FAILED', error = :error, finished_at = :now "
                        + "WHERE id = UUID_TO_BIN(:id) AND status IN ('QUEUED', 'RUNNING')")
                .param("id", id.toString()).param("error", error).param("now", utc(now)).update() == 1;
    }

    /** An instance stopping (deploy): another one starts the job again from the beginning. */
    void requeue(UUID id) {
        jdbc.sql("UPDATE export_jobs SET status = 'QUEUED', rows_written = 0, started_at = NULL, heartbeat_at = NULL "
                        + "WHERE id = UUID_TO_BIN(:id) AND status = 'RUNNING'")
                .param("id", id.toString()).update();
    }

    void delete(UUID id) {
        jdbc.sql("DELETE FROM export_jobs WHERE id = UUID_TO_BIN(:id)").param("id", id.toString()).update();
    }

    void setLink(UUID id, String tokenHash, Instant expiresAt) {
        jdbc.sql("UPDATE export_jobs SET link_token_hash = :hash, link_expires_at = :expiresAt "
                        + "WHERE id = UUID_TO_BIN(:id)")
                .param("id", id.toString()).param("hash", tokenHash).param("expiresAt", utc(expiresAt)).update();
    }

    /** Uses up a download link: true once for a valid, unexpired token of a ready export. */
    boolean useLink(UUID id, String tokenHash, Instant now) {
        return jdbc.sql("UPDATE export_jobs SET link_token_hash = NULL, link_expires_at = NULL "
                        + "WHERE id = UUID_TO_BIN(:id) AND status = 'READY' AND link_token_hash = :hash "
                        + "AND link_expires_at > :now AND expires_at > :now")
                .param("id", id.toString()).param("hash", tokenHash).param("now", utc(now)).update() == 1;
    }

    /** Ready exports whose download time is over. */
    List<ExportJob> expired(Instant now) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM export_jobs WHERE status = 'READY' AND expires_at <= :now")
                .param("now", utc(now)).query((rs, i) -> job(rs)).list();
    }

    void markExpired(UUID id) {
        jdbc.sql("UPDATE export_jobs SET status = 'EXPIRED', storage_key = NULL, link_token_hash = NULL, "
                        + "link_expires_at = NULL WHERE id = UUID_TO_BIN(:id) AND status = 'READY'")
                .param("id", id.toString()).update();
    }

    /** Running jobs with no sign of life since {@code cutoff}: their instance stopped without handing them back. */
    List<UUID> stale(Instant cutoff) {
        return jdbc.sql("SELECT BIN_TO_UUID(id) FROM export_jobs WHERE status = 'RUNNING' AND heartbeat_at < :cutoff")
                .param("cutoff", utc(cutoff)).query(String.class).list().stream().map(UUID::fromString).toList();
    }

    /** Finished jobs older than the list shows (no file left: expired or failed). */
    int deleteFinishedBefore(Instant cutoff) {
        return jdbc.sql("DELETE FROM export_jobs WHERE status IN ('EXPIRED', 'FAILED') AND created_at < :cutoff")
                .param("cutoff", utc(cutoff)).update();
    }

    private ExportJob job(ResultSet rs) throws SQLException {
        return new ExportJob(UUID.fromString(rs.getString("id")), ExportFormat.valueOf(rs.getString("format")),
                json.readValue(rs.getString("filters"), Filters.class), instant(rs, "as_of"),
                rs.getString("requested_by"), rs.getString("requested_by_name"), Status.valueOf(rs.getString("status")),
                rs.getObject("total_rows", Long.class), rs.getLong("rows_written"), rs.getObject("parts", Integer.class),
                rs.getString("storage_key"), rs.getString("file_name"), rs.getObject("size_bytes", Long.class),
                rs.getString("error"), instant(rs, "created_at"), instant(rs, "started_at"),
                instant(rs, "finished_at"), instant(rs, "expires_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        LocalDateTime value = rs.getObject(column, LocalDateTime.class);
        return value == null ? null : value.toInstant(ZoneOffset.UTC);
    }

    private static LocalDateTime utc(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
