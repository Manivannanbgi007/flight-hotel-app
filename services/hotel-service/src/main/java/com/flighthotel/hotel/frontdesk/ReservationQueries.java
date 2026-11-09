package com.flighthotel.hotel.frontdesk;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.flighthotel.hotel.dto.FrontDeskDtos.DateField;
import com.flighthotel.hotel.dto.FrontDeskDtos.ReservationRow;
import com.flighthotel.hotel.entity.ReservationStatus;
import com.flighthotel.hotel.support.Paging;
import com.flighthotel.hotel.support.Uuids;

/**
 * The manager's reservation list in plain SQL: one query joins the room type, the rate plan and the lead guest, so a
 * page never loads entities row by row. Timestamps are read and written as UTC wall-clock time, the way Hibernate
 * stores them ({@code hibernate.jdbc.time_zone = UTC}).
 */
@Component
public class ReservationQueries {

    /** What a manager means by "reservations": paid stays. Held/expired/released ones only when asked for. */
    public static final List<ReservationStatus> PAID = List.of(ReservationStatus.CONFIRMED,
            ReservationStatus.CHECKED_IN, ReservationStatus.CHECKED_OUT, ReservationStatus.NO_SHOW,
            ReservationStatus.CANCELLED);

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "checkIn", "r.check_in",
            "checkOut", "r.check_out",
            "createdAt", "r.created_at",
            "totalAmount", "r.total_amount",
            "bookingReference", "r.booking_reference",
            "status", "r.status");

    private static final String SELECT = """
            SELECT r.id, r.booking_id, r.booking_reference, r.status, r.check_in, r.check_out, r.rooms, r.adults,
                   r.children, rt.name AS room_type_name, rp.name AS rate_plan_name, g.first_name, g.last_name,
                   r.total_amount, r.currency, r.confirmation_number, r.created_at
            FROM hotel_reservations r
            JOIN room_types rt ON rt.id = r.room_type_id
            JOIN rate_plans rp ON rp.id = r.rate_plan_id
            LEFT JOIN hotel_reservation_guests g ON g.reservation_id = r.id AND g.room_no = 1
            """;

    private final JdbcClient jdbc;

    public ReservationQueries(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @param statuses  empty = the paid ones ({@link #PAID})
     * @param from      first day (inclusive) of {@code dateField}, or null
     * @param to        last day (inclusive), or null
     * @param zone      the hotel's time zone (for the creation day)
     * @param q         booking reference, confirmation number or a guest's name (contains, any case)
     */
    public Page<ReservationRow> find(UUID hotelId, List<ReservationStatus> statuses, LocalDate from, LocalDate to,
            DateField dateField, String q, ZoneId zone, Pageable pageable) {
        return find(hotelId, statuses, from, to, dateField, q, null, zone, pageable);
    }

    /** As above, optionally only one room type. */
    public Page<ReservationRow> find(UUID hotelId, List<ReservationStatus> statuses, LocalDate from, LocalDate to,
            DateField dateField, String q, UUID roomTypeId, ZoneId zone, Pageable pageable) {
        Map<String, Object> params = new HashMap<>();
        StringBuilder where = filter(hotelId, from, to, dateField, q, roomTypeId, zone, params);
        where.append(" AND r.status IN (:statuses)");
        params.put("statuses", (statuses == null || statuses.isEmpty() ? PAID : statuses).stream().map(Enum::name)
                .toList());
        long total = jdbc.sql("SELECT COUNT(*) FROM hotel_reservations r" + where).params(params)
                .query(Long.class).single();
        PageRequest page = PageRequest.of(Math.max(pageable.getPageNumber(), 0), Paging.size(pageable.getPageSize()));
        List<ReservationRow> rows = total == 0 ? List.of()
                : jdbc.sql(SELECT + where + orderBy(pageable.getSort()) + " LIMIT :limit OFFSET :offset")
                        .params(params)
                        .param("limit", page.getPageSize())
                        .param("offset", page.getOffset())
                        .query(ReservationQueries::row)
                        .list();
        return new PageImpl<>(rows, page, total);
    }

    /** The WHERE clause shared by the list and its counts: hotel, dates, search words and room type (not the status). */
    private static StringBuilder filter(UUID hotelId, LocalDate from, LocalDate to, DateField dateField, String q,
            UUID roomTypeId, ZoneId zone, Map<String, Object> params) {
        StringBuilder where = new StringBuilder(" WHERE r.hotel_id = :hotel");
        params.put("hotel", Uuids.param(hotelId));
        if (dateField == DateField.CREATED) {
            if (from != null) {
                where.append(" AND r.created_at >= :from");
                params.put("from", utc(from, zone));
            }
            if (to != null) {
                where.append(" AND r.created_at < :to");
                params.put("to", utc(to.plusDays(1), zone));
            }
        } else {
            if (from != null) {
                where.append(" AND r.check_in >= :from");
                params.put("from", from);
            }
            if (to != null) {
                where.append(" AND r.check_in <= :to");
                params.put("to", to);
            }
        }
        if (q != null && !q.isBlank()) {
            where.append(' ').append("""
                    AND (LOWER(r.booking_reference) LIKE :q OR LOWER(r.confirmation_number) LIKE :q
                      OR EXISTS (SELECT 1 FROM hotel_reservation_guests gq WHERE gq.reservation_id = r.id
                                 AND LOWER(CONCAT(gq.first_name, ' ', gq.last_name)) LIKE :q))""");
            params.put("q", "%" + q.strip().toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%")
                    .replace("_", "\\_") + "%");
        }

        if (roomTypeId != null) {
            where.append(" AND r.room_type_id = :roomType");
            params.put("roomType", Uuids.param(roomTypeId));
        }
        return where;
    }

    /** Reservations per status for the same filters as the list (every status, also held ones). */
    public Map<ReservationStatus, Long> statusCounts(UUID hotelId, LocalDate from, LocalDate to, DateField dateField,
            String q, UUID roomTypeId, ZoneId zone) {
        Map<String, Object> params = new HashMap<>();
        StringBuilder where = filter(hotelId, from, to, dateField, q, roomTypeId, zone, params);
        Map<ReservationStatus, Long> counts = new java.util.EnumMap<>(ReservationStatus.class);
        jdbc.sql("SELECT r.status, COUNT(*) AS n FROM hotel_reservations r" + where + " GROUP BY r.status")
                .params(params)
                .query((rs, i) -> {
                    counts.put(ReservationStatus.valueOf(rs.getString("status")), rs.getLong("n"));
                    return null;
                }).list();
        return counts;
    }

    /** Whitelisted columns only; newest bookings first by default. The id breaks ties so pages never overlap. */
    static String orderBy(Sort sort) {
        List<String> parts = new ArrayList<>();
        sort.forEach(order -> {
            String column = SORT_COLUMNS.get(order.getProperty());
            if (column != null) {
                parts.add(column + (order.isAscending() ? " ASC" : " DESC"));
            }
        });
        if (parts.isEmpty()) {
            parts.add("r.created_at DESC");
        }
        parts.add("r.id" + (parts.getFirst().endsWith("ASC") ? " ASC" : " DESC"));
        return " ORDER BY " + String.join(", ", parts);
    }

    /** Midnight of a day at the hotel, as the UTC wall-clock time stored in DATETIME columns. */
    static LocalDateTime utc(LocalDate day, ZoneId zone) {
        return LocalDateTime.ofInstant(day.atStartOfDay(zone).toInstant(), ZoneOffset.UTC);
    }

    static ReservationRow row(ResultSet rs, int rowNum) throws SQLException {
        LocalDate checkIn = rs.getObject("check_in", LocalDate.class);
        LocalDate checkOut = rs.getObject("check_out", LocalDate.class);
        String first = rs.getString("first_name");
        String last = rs.getString("last_name");
        return new ReservationRow(Uuids.fromBytes(rs.getBytes("id")), Uuids.fromBytes(rs.getBytes("booking_id")),
                rs.getString("booking_reference"), ReservationStatus.valueOf(rs.getString("status")), checkIn,
                checkOut, (int) ChronoUnit.DAYS.between(checkIn, checkOut), rs.getInt("rooms"), rs.getInt("adults"),
                rs.getInt("children"), rs.getString("room_type_name"), rs.getString("rate_plan_name"),
                first == null ? null : first + " " + last, rs.getBigDecimal("total_amount"), rs.getString("currency"),
                rs.getString("confirmation_number"),
                rs.getObject("created_at", LocalDateTime.class).toInstant(ZoneOffset.UTC));
    }
}
