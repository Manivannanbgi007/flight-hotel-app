package com.flighthotel.reporting.export;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import com.flighthotel.reporting.audit.AuditLogStore.AuditLogEntry;

/**
 * The columns of an audit log export: the same headers, order and values as the web export of the Audit logs page
 * ({@code EXPORT_COLUMNS} in {@code AdminAuditLogsPage.tsx}), so a file looks the same whichever way it was made.
 * Details hold ids and amounts only, as on screen.
 */
public final class AuditExportColumns {

    /** {@code text}: a string cell; {@code datetime}: an {@link Instant}, written as an India date and time. */
    public enum Kind { TEXT, DATETIME }

    public record Column(String header, Kind kind, int width, Function<AuditLogEntry, Object> value) {
    }

    private static final Map<String, String> ROLE_LABELS = Map.of(
            "CUSTOMER", "Customer",
            "ADMIN", "Admin",
            "HOTEL_MANAGER", "Hotel manager",
            "SUPPORT_AGENT", "Support agent");

    public static final List<Column> COLUMNS = List.of(
            new Column("When", Kind.DATETIME, 18, AuditLogEntry::occurredAt),
            new Column("Action", Kind.TEXT, 30, entry -> humanize(entry.action())),
            new Column("Action code", Kind.TEXT, 32, AuditLogEntry::action),
            new Column("Entity type", Kind.TEXT, 16, entry -> humanize(entry.entityType())),
            new Column("Entity id", Kind.TEXT, 38, AuditLogEntry::entityId),
            new Column("Actor", Kind.TEXT, 18, AuditExportColumns::actor),
            new Column("Actor id", Kind.TEXT, 38, AuditLogEntry::actorId),
            new Column("Details", Kind.TEXT, 50, AuditExportColumns::details),
            new Column("Service", Kind.TEXT, 22, AuditLogEntry::service),
            new Column("IP address", Kind.TEXT, 16, AuditLogEntry::ipAddress),
            new Column("Correlation id", Kind.TEXT, 38, AuditLogEntry::correlationId));

    private AuditExportColumns() {
    }

    /** {@code BOOKING_CANCELLED} → "Booking cancelled", like the web app's {@code humanize}. */
    public static String humanize(String code) {
        if (code == null || code.isBlank()) {
            return "";
        }
        String words = code.replaceAll("[._-]+", " ").strip().toLowerCase(Locale.ROOT);
        return words.isEmpty() ? "" : Character.toUpperCase(words.charAt(0)) + words.substring(1);
    }

    static String actor(AuditLogEntry entry) {
        if (entry.actorRoles() == null || entry.actorRoles().isEmpty()) {
            return "System";
        }
        return entry.actorRoles().stream().map(role -> ROLE_LABELS.getOrDefault(role, humanize(role)))
                .collect(Collectors.joining(", "));
    }

    static String details(AuditLogEntry entry) {
        if (entry.details() == null) {
            return "";
        }
        return entry.details().entrySet().stream()
                .map(detail -> detail.getKey() + ": " + (detail.getValue() == null ? "—" : detail.getValue()))
                .collect(Collectors.joining("; "));
    }
}
