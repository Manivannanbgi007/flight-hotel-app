package com.flighthotel.reporting.audit;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.events.audit.AuditEventRecorded;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * The audit trail (API_DOCUMENTATION.md section 11): stores every {@code AuditEventRecorded} once and lets admins search
 * it. Times are stored in UTC.
 */
@Service
public class AuditLogStore {

    private static final int MAX_PAGE_SIZE = 100;
    private static final String COLUMNS = "BIN_TO_UUID(id) AS id, occurred_at, service, actor_id, actor_roles, action, "
            + "entity_type, entity_id, details, ip_address, correlation_id";
    /**
     * Newest first. Qualified on purpose: in ORDER BY, MySQL reads a bare {@code id} as the select list's alias (the
     * text of {@code BIN_TO_UUID(id)}), which no index holds, so it read and sorted the whole table (measured: 40 s for
     * the first 5,000 of 10 million entries). The table's columns are what the indexes hold (InnoDB adds {@code id}).
     */
    private static final String NEWEST_FIRST = " ORDER BY audit_logs.occurred_at DESC, audit_logs.id DESC";

    private final JdbcClient jdbc;
    private final JsonMapper json;
    private final Clock clock;

    public AuditLogStore(JdbcClient jdbc, JsonMapper json, Clock clock) {
        this.jdbc = jdbc;
        this.json = json;
        this.clock = clock;
    }

    /** @return false when the event was stored before (redelivery) */
    @Transactional
    public boolean store(String eventId, AuditEventRecorded event) {
        int inserted = jdbc.sql("INSERT IGNORE INTO audit_logs (id, source_event_id, service, actor_id, actor_roles, "
                        + "action, entity_type, entity_id, details, ip_address, correlation_id, occurred_at, received_at) "
                        + "VALUES (UUID_TO_BIN(:id), :eventId, :service, :actorId, :roles, :action, :entityType, "
                        + ":entityId, :details, :ip, :correlationId, :occurredAt, :receivedAt)")
                .param("id", UuidV7.generate().toString())
                .param("eventId", eventId)
                .param("service", event.getService())
                .param("actorId", event.getActorId())
                .param("roles", event.getActorRoles().isEmpty() ? null : String.join(",", event.getActorRoles()))
                .param("action", event.getAction())
                .param("entityType", event.getEntityType())
                .param("entityId", event.getEntityId())
                .param("details", json.writeValueAsString(new TreeMap<>(event.getDetails())))
                .param("ip", event.getIpAddress())
                .param("correlationId", event.getCorrelationId())
                .param("occurredAt", utc(event.getOccurredAt()))
                .param("receivedAt", utc(clock.instant()))
                .update();
        return inserted == 1;
    }

    public record AuditLogEntry(String id, Instant occurredAt, String service, String actorId, List<String> actorRoles,
            String action, String entityType, String entityId, Map<String, String> details, String ipAddress,
            String correlationId) {
    }

    public record Filter(String action, String entityType, String entityId, String actorId, Instant from, Instant to) {
    }

    /** Newest first. */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public PageResponse<AuditLogEntry> search(Filter filter, int page, int size) {
        int pageSize = Math.clamp(size, 1, MAX_PAGE_SIZE);
        int pageNo = Math.max(page, 0);
        Where where = Where.of(filter, null);
        long total = jdbc.sql("SELECT COUNT(*) FROM audit_logs" + where.sql()).params(where.params())
                .query(Long.class).single();
        List<AuditLogEntry> rows = jdbc.sql("SELECT " + COLUMNS + " FROM audit_logs" + where.sql() + NEWEST_FIRST
                        + " LIMIT :limit OFFSET :offset")
                .params(where.params())
                .param("limit", pageSize)
                .param("offset", pageNo * pageSize)
                .query((rs, i) -> entry(rs))
                .list();
        return new PageResponse<>(rows, pageNo, pageSize, total, (int) ((total + pageSize - 1) / pageSize));
    }

    // ------------------------------------------------------------------ exports (no security context: the export
    // service checked the admin when the export was requested)

    /** Whether any entry recorded up to {@code asOf} matches. */
    @Transactional(readOnly = true)
    public boolean anyMatch(Filter filter, Instant asOf) {
        Where where = Where.of(filter, asOf);
        return !jdbc.sql("SELECT 1 FROM audit_logs" + where.sql() + " LIMIT 1").params(where.params())
                .query(Integer.class).list().isEmpty();
    }

    /** The entries an export will contain: matching the filters and recorded up to {@code asOf}. */
    @Transactional(readOnly = true)
    public long count(Filter filter, Instant asOf) {
        Where where = Where.of(filter, asOf);
        return jdbc.sql("SELECT COUNT(*) FROM audit_logs" + where.sql()).params(where.params()).query(Long.class)
                .single();
    }

    /** Receives one batch of entries; returns false to stop reading (the export was cancelled). */
    @FunctionalInterface
    public interface BatchHandler {
        boolean accept(List<AuditLogEntry> batch);
    }

    /**
     * Every entry an export contains, newest first, in batches. Each batch continues after the last entry of the one
     * before ({@code occurred_at}, then {@code id}) instead of skipping rows with OFFSET, so every batch is a short
     * index range read however deep into the trail it is, and no transaction stays open while the file is written.
     *
     * @return the number of entries read
     */
    public long forEachBatch(Filter filter, Instant asOf, int batchSize, BatchHandler handler) {
        Where where = Where.of(filter, asOf);
        long read = 0;
        LocalDateTime cursorAt = null;
        String cursorId = null;
        while (true) {
            // The index is named, so the plan never depends on the optimizer's row estimates: walking it backwards
            // reads only the batch, however deep into a large table the cursor is.
            String sql = "SELECT " + COLUMNS + " FROM audit_logs FORCE INDEX (" + where.orderIndex() + ")" + where.sql()
                    + (cursorAt == null ? "" : " AND (audit_logs.occurred_at < :cursorAt OR (audit_logs.occurred_at "
                            + "= :cursorAt AND audit_logs.id < UUID_TO_BIN(:cursorId)))")
                    + NEWEST_FIRST + " LIMIT :limit";
            JdbcClient.StatementSpec statement = jdbc.sql(sql).params(where.params()).param("limit", batchSize);
            if (cursorAt != null) {
                statement = statement.param("cursorAt", cursorAt).param("cursorId", cursorId);
            }
            List<AuditLogEntry> batch = statement.query((rs, i) -> entry(rs)).list();
            if (batch.isEmpty()) {
                return read;
            }
            read += batch.size();
            if (!handler.accept(batch) || batch.size() < batchSize) {
                return read;
            }
            AuditLogEntry last = batch.getLast();
            cursorAt = utc(last.occurredAt());
            cursorId = last.id();
        }
    }

    private AuditLogEntry entry(ResultSet rs) throws SQLException {
        return new AuditLogEntry(rs.getString("id"),
                rs.getObject("occurred_at", LocalDateTime.class).toInstant(ZoneOffset.UTC),
                rs.getString("service"), rs.getString("actor_id"),
                rs.getString("actor_roles") == null ? List.of() : List.of(rs.getString("actor_roles").split(",")),
                rs.getString("action"), rs.getString("entity_type"), rs.getString("entity_id"),
                rs.getString("details") == null ? Map.of()
                        : json.readValue(rs.getString("details"), new TypeReference<Map<String, String>>() { }),
                rs.getString("ip_address"), rs.getString("correlation_id"));
    }

    /** The WHERE clause of the filters (always present, so more conditions can follow with AND). */
    private record Where(String sql, Map<String, Object> params, String orderIndex) {

        static Where of(Filter filter, Instant recordedUpTo) {
            List<String> where = new ArrayList<>();
            Map<String, Object> params = new HashMap<>();
            condition(where, params, "action", filter.action());
            condition(where, params, "entity_type", filter.entityType());
            condition(where, params, "entity_id", filter.entityId());
            condition(where, params, "actor_id", filter.actorId());
            if (filter.from() != null) {
                where.add("occurred_at >= :fromTime");
                params.put("fromTime", utc(filter.from()));
            }
            if (filter.to() != null) {
                where.add("occurred_at < :toTime");
                params.put("toTime", utc(filter.to()));
            }
            if (recordedUpTo != null) {
                where.add("received_at <= :recordedUpTo");
                params.put("recordedUpTo", utc(recordedUpTo));
            }
            return new Where(" WHERE " + (where.isEmpty() ? "TRUE" : String.join(" AND ", where)), params,
                    indexFor(params));
        }

        /**
         * The index that holds the matching entries newest first: its equality columns, then {@code occurred_at} (and
         * the primary key {@code id}, which InnoDB adds to every index). Fixed names, never taken from the request.
         */
        private static String indexFor(Map<String, Object> params) {
            if (params.containsKey("entity_type") && params.containsKey("entity_id")) {
                return "idx_audit_logs_entity";
            }
            if (params.containsKey("actor_id")) {
                return "idx_audit_logs_actor";
            }
            if (params.containsKey("action")) {
                return "idx_audit_logs_action";
            }
            return "idx_audit_logs_occurred";
        }

        /** Exact match on one column (the column names are fixed here, never taken from the request). */
        private static void condition(List<String> where, Map<String, Object> params, String column, String value) {
            if (value != null && !value.isBlank()) {
                where.add(column + " = :" + column);
                params.put(column, value.strip());
            }
        }
    }

    /** DATETIME columns hold UTC; a plain LocalDateTime keeps the driver from shifting it. */
    private static LocalDateTime utc(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
