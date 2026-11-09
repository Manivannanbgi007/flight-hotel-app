package com.flighthotel.reporting.report;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ResourceNotFoundException;

/**
 * The admin reports (API_DOCUMENTATION.md section 14.1): one SQL definition per report over the facts, then the same
 * paging, sorting, totals and export for all of them. Totals are calculated over every row of the range and filters,
 * not only the page. Column names and sort fields come from the definitions here, never from the request.
 */
@Service
@Transactional(readOnly = true)
public class ReportService {

    public static final int EXPORT_LIMIT = 10_000;
    private static final Pattern STATUS = Pattern.compile("^[A-Z_]{3,25}$");
    private static final String DAY = DashboardService.INDIA_DAY;

    private final JdbcClient jdbc;

    public ReportService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public enum Type { TEXT, MONEY, NUMBER, DATE, DATETIME }

    public record Column(String key, String label, Type type) {
    }

    public record Filters(String q, String type, String status, String sort) {
    }

    public record ReportPage(String report, String title, ReportRange range, List<Column> columns,
            List<Map<String, Object>> content, int page, int size, long totalElements, int totalPages,
            Map<String, Object> totals) {
    }

    /** All rows (an export), with the totals. */
    public record ReportRows(String report, String title, ReportRange range, List<Column> columns,
            List<Map<String, Object>> rows, Map<String, Object> totals) {
    }

    /**
     * @param base       a SELECT whose aliases are the column keys (plus {@code extras}, e.g. ids for links)
     * @param totals     aggregates over {@code r} (the base as a derived table), aliased with the totals' keys
     * @param sorts      sort field to alias; the first is the tie-breaker's partner
     * @param defaultSort e.g. "createdAt,desc"
     */
    private record Definition(String title, List<Column> columns, List<String> extras, String base,
            Map<String, Object> params, String totals, Map<String, String> sorts, String defaultSort,
            String tieBreaker) {
    }

    @PreAuthorize("hasAuthority('REPORT_VIEW')")
    public ReportPage page(String report, ReportRange range, Filters filters, int page, int size) {
        Definition d = definition(report, range, filters);
        int pageSize = Math.clamp(size, 1, 100);
        int pageNo = Math.max(page, 0);
        String order = orderBy(d, filters.sort());
        Map<String, Object> totals = totals(d);
        long count = ((Number) totals.remove("__rows")).longValue();
        List<Map<String, Object>> content = jdbc.sql("SELECT * FROM (" + d.base() + ") r ORDER BY " + order
                        + " LIMIT :limit OFFSET :offset")
                .params(d.params()).param("limit", pageSize).param("offset", (long) pageNo * pageSize)
                .query((rs, i) -> row(rs, d)).list();
        return new ReportPage(report, d.title(), range, d.columns(), content, pageNo, pageSize, count,
                (int) ((count + pageSize - 1) / pageSize), totals);
    }

    /** Every row for an export; more than {@value #EXPORT_LIMIT} answers {@code 422 EXPORT_TOO_LARGE}. */
    @PreAuthorize("hasAuthority('REPORT_VIEW')")
    public ReportRows all(String report, ReportRange range, Filters filters) {
        Definition d = definition(report, range, filters);
        Map<String, Object> totals = totals(d);
        long count = ((Number) totals.remove("__rows")).longValue();
        if (count > EXPORT_LIMIT) {
            throw new BusinessRuleException("EXPORT_TOO_LARGE", "This export has " + count + " rows; at most "
                    + EXPORT_LIMIT + " can be exported. Choose a shorter range or add filters.",
                    Map.of("rows", count, "limit", EXPORT_LIMIT));
        }
        List<Map<String, Object>> rows = jdbc.sql("SELECT * FROM (" + d.base() + ") r ORDER BY "
                        + orderBy(d, filters.sort()) + " LIMIT " + (EXPORT_LIMIT + 1))
                .params(d.params()).query((rs, i) -> row(rs, d)).list();
        return new ReportRows(report, d.title(), range, d.columns(), rows, totals);
    }

    // ================================================================== the reports

    private Definition definition(String report, ReportRange range, Filters f) {
        Map<String, Object> params = new HashMap<>();
        params.put("start", range.startUtc());
        params.put("end", range.endUtc());
        String q = f.q() == null || f.q().isBlank() ? null : f.q().strip();
        if (q != null) {
            params.put("qUpper", q.toUpperCase(Locale.ROOT));
            params.put("qLower", q.toLowerCase(Locale.ROOT));
            params.put("qLike", "%" + q.toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%")
                    .replace("_", "\\_") + "%");
        }
        return switch (report) {
            case "bookings" -> bookings(params, q, type(f.type()), status(f.status(), null));
            case "revenue" -> revenue(range, params);
            case "payments" -> payments(params, q, status(f.status(), Set.of("SUCCESS", "FAILED")));
            case "refunds" -> refunds(params, q, status(f.status(), Set.of("REQUESTED", "COMPLETED", "FAILED")));
            case "cancellations" -> cancellations(params, q, type(f.type()));
            case "destinations" -> destinations(params, q);
            case "customers" -> customers(params, q);
            default -> throw new ResourceNotFoundException("Report", report);
        };
    }

    private Definition bookings(Map<String, Object> params, String q, String type, String status) {
        StringBuilder where = new StringBuilder("b.created_at >= :start AND b.created_at < :end");
        filter(where, params, "b.booking_type", "type", type);
        filter(where, params, "b.status", "status", status);
        if (q != null) {
            where.append(" AND (b.booking_reference = :qUpper OR b.contact_email = :qLower"
                    + " OR LOWER(b.title) LIKE :qLike OR LOWER(b.destination) LIKE :qLike)");
        }
        return new Definition("Bookings", List.of(
                        col("reference", "Reference", Type.TEXT), col("type", "Type", Type.TEXT),
                        col("status", "Status", Type.TEXT), col("paymentStatus", "Payment", Type.TEXT),
                        col("title", "Booking", Type.TEXT), col("destination", "Destination", Type.TEXT),
                        col("travelDate", "Travel date", Type.DATE), col("customerEmail", "Customer e-mail", Type.TEXT),
                        col("totalAmount", "Total", Type.MONEY), col("refundedAmount", "Refunded", Type.MONEY),
                        col("createdAt", "Booked at", Type.DATETIME)),
                List.of("bookingId"), """
                SELECT BIN_TO_UUID(b.booking_id) AS bookingId, b.booking_reference AS reference,
                    b.booking_type AS type, b.status AS status, b.payment_status AS paymentStatus, b.title AS title,
                    b.destination AS destination, b.start_date AS travelDate, b.contact_email AS customerEmail,
                    b.total_amount AS totalAmount, b.refunded_amount AS refundedAmount, b.created_at AS createdAt
                FROM booking_facts b WHERE""" + " " + where, params,
                "COUNT(*) AS `count`, COALESCE(SUM(totalAmount), 0) AS totalAmount, "
                        + "COALESCE(SUM(refundedAmount), 0) AS refundedAmount",
                Map.of("createdAt", "createdAt", "totalAmount", "totalAmount", "travelDate", "travelDate"),
                "createdAt,desc", "bookingId");
    }

    private Definition revenue(ReportRange range, Map<String, Object> params) {
        params.put("fromDate", range.from());
        params.put("toDate", range.to());
        return new Definition("Revenue", List.of(
                        col("date", "Date", Type.DATE), col("payments", "Payments", Type.NUMBER),
                        col("gross", "Gross", Type.MONEY), col("refunds", "Refunds", Type.MONEY),
                        col("net", "Net", Type.MONEY)),
                List.of(), """
                WITH RECURSIVE days AS (
                    SELECT CAST(:fromDate AS DATE) AS d UNION ALL SELECT d + INTERVAL 1 DAY FROM days WHERE d < :toDate)
                SELECT days.d AS `date`, COALESCE(p.payments, 0) AS payments, COALESCE(p.gross, 0) AS gross,
                    COALESCE(f.refunds, 0) AS refunds, COALESCE(p.gross, 0) - COALESCE(f.refunds, 0) AS net
                FROM days
                LEFT JOIN (SELECT %s AS d, COUNT(*) AS payments, SUM(amount) AS gross FROM payment_facts
                           WHERE status = 'SUCCESS' AND occurred_at >= :start AND occurred_at < :end GROUP BY d) p
                    ON p.d = days.d
                LEFT JOIN (SELECT %s AS d, SUM(amount) AS refunds FROM refund_facts
                           WHERE status = 'COMPLETED' AND completed_at >= :start AND completed_at < :end GROUP BY d) f
                    ON f.d = days.d""".formatted(DAY.formatted("occurred_at"), DAY.formatted("completed_at")), params,
                "COALESCE(SUM(payments), 0) AS payments, COALESCE(SUM(gross), 0) AS gross, "
                        + "COALESCE(SUM(refunds), 0) AS refunds, COALESCE(SUM(net), 0) AS net",
                Map.of("date", "date"), "date,asc", "date");
    }

    private Definition payments(Map<String, Object> params, String q, String status) {
        StringBuilder where = new StringBuilder("p.occurred_at >= :start AND p.occurred_at < :end");
        filter(where, params, "p.status", "status", status);
        if (q != null) {
            where.append(" AND (b.booking_reference = :qUpper OR BIN_TO_UUID(p.payment_id) = :qLower)");
        }
        return new Definition("Payments", List.of(
                        col("paymentId", "Payment id", Type.TEXT), col("bookingReference", "Booking", Type.TEXT),
                        col("provider", "Provider", Type.TEXT), col("method", "Method", Type.TEXT),
                        col("status", "Status", Type.TEXT), col("amount", "Amount", Type.MONEY),
                        col("refundedAmount", "Refunded", Type.MONEY), col("at", "At", Type.DATETIME)),
                List.of("bookingId"), """
                SELECT BIN_TO_UUID(p.payment_id) AS paymentId, b.booking_reference AS bookingReference,
                    BIN_TO_UUID(p.booking_id) AS bookingId, p.provider AS provider, p.method AS method,
                    p.status AS status, COALESCE(p.amount, b.total_amount, 0) AS amount,
                    COALESCE(r.refunded, 0) AS refundedAmount, p.occurred_at AS `at`
                FROM payment_facts p
                LEFT JOIN booking_facts b ON b.booking_id = p.booking_id
                LEFT JOIN (SELECT payment_id, SUM(amount) AS refunded FROM refund_facts WHERE status = 'COMPLETED'
                           GROUP BY payment_id) r ON r.payment_id = p.payment_id
                WHERE""" + " " + where, params,
                "COUNT(*) AS `count`, COALESCE(SUM(amount), 0) AS amount, "
                        + "COALESCE(SUM(refundedAmount), 0) AS refundedAmount",
                Map.of("at", "at", "amount", "amount"), "at,desc", "paymentId");
    }

    private Definition refunds(Map<String, Object> params, String q, String status) {
        StringBuilder where = new StringBuilder("COALESCE(f.requested_at, f.completed_at, f.failed_at) >= :start "
                + "AND COALESCE(f.requested_at, f.completed_at, f.failed_at) < :end");
        filter(where, params, "f.status", "status", status);
        if (q != null) {
            where.append(" AND COALESCE(f.booking_reference, b.booking_reference) = :qUpper");
        }
        return new Definition("Refunds", List.of(
                        col("refundRequestId", "Refund id", Type.TEXT), col("bookingReference", "Booking", Type.TEXT),
                        col("reason", "Reason", Type.TEXT), col("status", "Status", Type.TEXT),
                        col("amount", "Amount", Type.MONEY), col("requestedAt", "Requested at", Type.DATETIME),
                        col("completedAt", "Completed at", Type.DATETIME)),
                List.of("bookingId"), """
                SELECT BIN_TO_UUID(f.refund_request_id) AS refundRequestId,
                    COALESCE(f.booking_reference, b.booking_reference) AS bookingReference,
                    BIN_TO_UUID(f.booking_id) AS bookingId, f.reason AS reason, f.status AS status,
                    f.amount AS amount, COALESCE(f.requested_at, f.completed_at, f.failed_at) AS requestedAt,
                    f.completed_at AS completedAt
                FROM refund_facts f LEFT JOIN booking_facts b ON b.booking_id = f.booking_id
                WHERE""" + " " + where, params,
                "COUNT(*) AS `count`, COALESCE(SUM(amount), 0) AS amount",
                Map.of("requestedAt", "requestedAt", "amount", "amount"), "requestedAt,desc", "refundRequestId");
    }

    private Definition cancellations(Map<String, Object> params, String q, String type) {
        StringBuilder where = new StringBuilder("c.cancelled_at >= :start AND c.cancelled_at < :end");
        filter(where, params, "c.booking_type", "type", type);
        if (q != null) {
            where.append(" AND (c.booking_reference = :qUpper OR LOWER(c.title) LIKE :qLike)");
        }
        return new Definition("Cancellations", List.of(
                        col("bookingReference", "Booking", Type.TEXT), col("type", "Type", Type.TEXT),
                        col("title", "Booking", Type.TEXT), col("initiatedBy", "Cancelled by", Type.TEXT),
                        col("cancelledAt", "Cancelled at", Type.DATETIME), col("paidAmount", "Paid", Type.MONEY),
                        col("cancellationFee", "Fee", Type.MONEY), col("refundAmount", "Refund", Type.MONEY)),
                List.of("bookingId", "cancellationId"), """
                SELECT BIN_TO_UUID(c.cancellation_id) AS cancellationId, BIN_TO_UUID(c.booking_id) AS bookingId,
                    c.booking_reference AS bookingReference, c.booking_type AS type, c.title AS title,
                    c.initiated_by AS initiatedBy, c.cancelled_at AS cancelledAt, c.paid_amount AS paidAmount,
                    c.cancellation_fee AS cancellationFee, c.refund_amount AS refundAmount
                FROM cancellation_facts c WHERE""" + " " + where, params,
                "COUNT(*) AS `count`, COALESCE(SUM(cancellationFee), 0) AS cancellationFee, "
                        + "COALESCE(SUM(refundAmount), 0) AS refundAmount",
                Map.of("cancelledAt", "cancelledAt", "refundAmount", "refundAmount"), "cancelledAt,desc",
                "cancellationId");
    }

    /** Paid bookings created in the range, by city; revenue = what was paid minus what went back. */
    private Definition destinations(Map<String, Object> params, String q) {
        String search = q == null ? "" : " AND LOWER(destination) LIKE :qLike";
        return new Definition("Destinations", List.of(
                        col("city", "City", Type.TEXT), col("flightBookings", "Flight bookings", Type.NUMBER),
                        col("hotelBookings", "Hotel bookings", Type.NUMBER), col("bookings", "Bookings", Type.NUMBER),
                        col("revenue", "Revenue", Type.MONEY)),
                List.of(), """
                SELECT destination AS city, SUM(booking_type = 'FLIGHT') AS flightBookings,
                    SUM(booking_type = 'HOTEL') AS hotelBookings, COUNT(*) AS bookings,
                    SUM(total_amount - refunded_amount) AS revenue
                FROM booking_facts
                WHERE confirmed_at IS NOT NULL AND destination IS NOT NULL AND created_at >= :start
                    AND created_at < :end""" + search + " GROUP BY destination", params,
                "COALESCE(SUM(bookings), 0) AS bookings, COALESCE(SUM(revenue), 0) AS revenue",
                Map.of("bookings", "bookings", "revenue", "revenue"), "bookings,desc", "city");
    }

    /**
     * Customers registered by the end of the range, with their bookings created in the range: paid ones and what they
     * spent (paid minus refunded).
     */
    private Definition customers(Map<String, Object> params, String q) {
        String search = q == null ? "" : " AND (LOWER(u.email) LIKE :qLike OR LOWER(CONCAT(COALESCE(u.first_name, ''),"
                + " ' ', COALESCE(u.last_name, ''))) LIKE :qLike)";
        return new Definition("Customers", List.of(
                        col("email", "E-mail", Type.TEXT), col("name", "Name", Type.TEXT),
                        col("registeredAt", "Registered", Type.DATETIME), col("bookings", "Bookings", Type.NUMBER),
                        col("paidBookings", "Paid bookings", Type.NUMBER), col("spent", "Spent", Type.MONEY),
                        col("lastBookingAt", "Last booking", Type.DATETIME)),
                List.of("userId"), """
                SELECT BIN_TO_UUID(u.user_id) AS userId, u.email AS email,
                    TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS name,
                    u.registered_at AS registeredAt, COALESCE(x.bookings, 0) AS bookings,
                    COALESCE(x.paid, 0) AS paidBookings, COALESCE(x.spent, 0) AS spent, x.last_at AS lastBookingAt
                FROM user_facts u
                LEFT JOIN (SELECT user_id, COUNT(*) AS bookings, SUM(confirmed_at IS NOT NULL) AS paid,
                               SUM(IF(confirmed_at IS NOT NULL, total_amount - refunded_amount, 0)) AS spent,
                               MAX(created_at) AS last_at
                           FROM booking_facts WHERE created_at >= :start AND created_at < :end GROUP BY user_id) x
                    ON x.user_id = u.user_id
                WHERE FIND_IN_SET('CUSTOMER', u.roles) > 0 AND u.registered_at < :end""" + search, params,
                "COUNT(*) AS customers, COALESCE(SUM(spent), 0) AS spent",
                Map.of("spent", "spent", "bookings", "bookings", "registeredAt", "registeredAt",
                        "lastBookingAt", "lastBookingAt"), "spent,desc", "userId");
    }

    // ================================================================== shared

    private Map<String, Object> totals(Definition d) {
        Map<String, Object> raw = jdbc.sql("SELECT COUNT(*) AS `__rows`, " + d.totals() + " FROM (" + d.base() + ") r")
                .params(d.params()).query().singleRow();
        Map<String, Object> totals = new LinkedHashMap<>();
        raw.forEach((key, value) -> totals.put(key, value instanceof BigDecimal decimal
                ? (decimal.scale() > 0 ? decimal.setScale(2, java.math.RoundingMode.HALF_UP) : decimal) : value));
        return totals;
    }

    private static String orderBy(Definition d, String sort) {
        String text = sort == null || sort.isBlank() ? d.defaultSort() : sort.strip();
        String[] parts = text.split(",");
        String alias = d.sorts().get(parts[0].strip());
        String direction = parts.length > 1 ? parts[1].strip().toUpperCase(Locale.ROOT) : "ASC";
        if (alias == null || parts.length > 2 || !Set.of("ASC", "DESC").contains(direction)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SORT", "This report can be sorted by "
                    + String.join(", ", d.sorts().keySet()) + ", optionally followed by ,asc or ,desc.");
        }
        return "`" + alias + "` " + direction + ", `" + d.tieBreaker() + "` " + direction;
    }

    private static Map<String, Object> row(ResultSet rs, Definition d) throws SQLException {
        Map<String, Object> row = new LinkedHashMap<>();
        for (String extra : d.extras()) {
            row.put(extra, rs.getString(extra));
        }
        for (Column column : d.columns()) {
            row.put(column.key(), switch (column.type()) {
                case TEXT -> rs.getString(column.key());
                case MONEY -> {
                    BigDecimal value = rs.getBigDecimal(column.key());
                    yield value == null ? null : value.setScale(2, java.math.RoundingMode.HALF_UP);
                }
                case NUMBER -> rs.getLong(column.key());
                case DATE -> rs.getObject(column.key(), LocalDate.class);
                case DATETIME -> {
                    LocalDateTime value = rs.getObject(column.key(), LocalDateTime.class);
                    yield value == null ? null : value.toInstant(ZoneOffset.UTC);
                }
            });
        }
        return row;
    }

    private static void filter(StringBuilder where, Map<String, Object> params, String column, String param,
            String value) {
        if (value != null) {
            where.append(" AND ").append(column).append(" = :").append(param);
            params.put(param, value);
        }
    }

    private static String type(String type) {
        if (type == null || type.isBlank()) {
            return null;
        }
        String value = type.strip().toUpperCase(Locale.ROOT);
        if (!Set.of("FLIGHT", "HOTEL").contains(value)) {
            throw invalidFilter("type must be FLIGHT or HOTEL.");
        }
        return value;
    }

    private static String status(String status, Set<String> allowed) {
        if (status == null || status.isBlank()) {
            return null;
        }
        String value = status.strip().toUpperCase(Locale.ROOT);
        if (allowed == null ? !STATUS.matcher(value).matches() : !allowed.contains(value)) {
            throw invalidFilter(allowed == null ? "Unknown status." : "status must be one of " + allowed + ".");
        }
        return value;
    }

    private static ApiException invalidFilter(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_FILTER", message);
    }

    private static Column col(String key, String label, Type type) {
        return new Column(key, label, type);
    }
}
