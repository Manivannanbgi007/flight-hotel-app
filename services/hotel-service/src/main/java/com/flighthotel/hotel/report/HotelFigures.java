package com.flighthotel.hotel.report;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.flighthotel.hotel.dto.ReportDtos;
import com.flighthotel.hotel.dto.ReportDtos.OccupancyNight;
import com.flighthotel.hotel.dto.ReportDtos.OccupancyTotals;
import com.flighthotel.hotel.dto.ReportDtos.RevenueNight;
import com.flighthotel.hotel.dto.ReportDtos.RevenueTotals;
import com.flighthotel.hotel.support.Uuids;

/**
 * The hotel figures behind the manager dashboard, the occupancy and revenue reports and the admin overview, all
 * calculated from hotel-service's own data:
 * <ul>
 *   <li><b>Booked room-nights</b> (occupancy): {@code room_inventory.booked_rooms}, i.e. rooms sold for that night
 *       by confirmed, checked-in, checked-out or no-show stays. Held rooms (unpaid) do not count; cancelled stays
 *       gave their rooms back. After an early check-out or a no-show the nights still to come went back on sale and
 *       no longer count; the nights that passed do.</li>
 *   <li><b>Room-nights</b> (available): the rooms for sale that night ({@code total_rooms}). On a stop-sell night,
 *       and for a room type taken off sale (INACTIVE), only the rooms already sold count as available: those rooms
 *       were closed by the hotel, not left unsold, so they do not lower the occupancy.</li>
 *   <li><b>Occupancy %</b> = booked room-nights / room-nights × 100 (one decimal; 0 without rooms).</li>
 *   <li><b>Revenue</b>: room charges without GST ({@code subtotal}), spread evenly over the nights of the stay (the
 *       last night takes the rounding cent), on the nights they were sold for. Stays that are confirmed, checked
 *       in, checked out or no-show count (a no-show is not refunded). Cancelled stays do not: the hotel
 *       cancellation is refunded in full, and the fee a customer pays for a late cancellation is not room
 *       revenue. Held, expired and released stays were never paid.</li>
 *   <li><b>Sold room-nights</b> (revenue) = rooms of those stays on each night; <b>average daily rate</b> = revenue
 *       / sold room-nights (two decimals; 0 without rooms). Unlike occupancy they keep the nights given back after
 *       an early check-out or a no-show: those nights were paid for.</li>
 * </ul>
 * Rows exist for every night of the range, also nights without any inventory (zeros).
 */
@Component
public class HotelFigures {

    static final List<String> REVENUE_STATUSES = List.of("CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "NO_SHOW");
    static final List<String> PAID_STATUSES = List.of("CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "NO_SHOW",
            "CANCELLED");
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private final JdbcClient jdbc;

    public HotelFigures(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    // ------------------------------------------------------------------ per night

    /** Available and booked room-nights per hotel and night of [from, to]. */
    public Map<UUID, Map<LocalDate, Occupancy>> occupancy(Collection<UUID> hotelIds, LocalDate from, LocalDate to) {
        Map<UUID, Map<LocalDate, Occupancy>> result = new HashMap<>();
        if (hotelIds.isEmpty()) {
            return result;
        }
        jdbc.sql("""
                        SELECT rt.hotel_id, ri.stay_date,
                               SUM(CASE WHEN rt.status = 'ACTIVE' AND ri.stop_sell = FALSE THEN ri.total_rooms
                                        ELSE ri.booked_rooms END) AS room_nights,
                               SUM(ri.booked_rooms) AS booked
                        FROM room_inventory ri JOIN room_types rt ON rt.id = ri.room_type_id
                        WHERE rt.hotel_id IN (:hotels) AND ri.stay_date BETWEEN :from AND :to
                        GROUP BY rt.hotel_id, ri.stay_date""")
                .param("hotels", Uuids.params(hotelIds))
                .param("from", from)
                .param("to", to)
                .query((rs, i) -> {
                    result.computeIfAbsent(Uuids.fromBytes(rs.getBytes("hotel_id")), id -> new HashMap<>())
                            .put(rs.getObject("stay_date", LocalDate.class),
                                    new Occupancy(rs.getLong("room_nights"), rs.getLong("booked")));
                    return null;
                })
                .list();
        return result;
    }

    /** Revenue and sold room-nights per hotel and night of [from, to] (rules above). */
    public Map<UUID, Map<LocalDate, NightRevenue>> revenue(Collection<UUID> hotelIds, LocalDate from, LocalDate to) {
        Map<UUID, Map<LocalDate, NightRevenue>> result = new HashMap<>();
        if (hotelIds.isEmpty()) {
            return result;
        }
        jdbc.sql("""
                        SELECT hotel_id, check_in, check_out, rooms, subtotal FROM hotel_reservations
                        WHERE hotel_id IN (:hotels) AND status IN (:statuses)
                          AND check_in <= :to AND check_out > :from""")
                .param("hotels", Uuids.params(hotelIds))
                .param("statuses", REVENUE_STATUSES)
                .param("from", from)
                .param("to", to)
                .query((rs, i) -> {
                    Map<LocalDate, NightRevenue> nights = result.computeIfAbsent(
                            Uuids.fromBytes(rs.getBytes("hotel_id")), id -> new HashMap<>());
                    LocalDate checkIn = rs.getObject("check_in", LocalDate.class);
                    int stayNights = (int) ChronoUnit.DAYS.between(checkIn, rs.getObject("check_out", LocalDate.class));
                    BigDecimal subtotal = rs.getBigDecimal("subtotal");
                    int rooms = rs.getInt("rooms");
                    for (int n = 0; n < stayNights; n++) {
                        LocalDate night = checkIn.plusDays(n);
                        if (!night.isBefore(from) && !night.isAfter(to)) {
                            nights.computeIfAbsent(night, d -> new NightRevenue())
                                    .add(rooms, nightShare(subtotal, stayNights, n));
                        }
                    }
                    return null;
                })
                .list();
        return result;
    }

    // ------------------------------------------------------------------ rooms and room types

    /** Rooms the hotel can sell (the active room types' default inventory). */
    public long totalRooms(UUID hotelId) {
        return jdbc.sql("SELECT COALESCE(SUM(total_rooms), 0) FROM room_types WHERE hotel_id = :hotel AND status = 'ACTIVE'")
                .param("hotel", Uuids.param(hotelId)).query(Long.class).single();
    }

    /**
     * Room revenue and sold room-nights per room type on the nights of [from, to], by the same rules as the revenue
     * report: paid stays that were not cancelled, the room charges spread evenly over the nights. A type without any
     * sale in the range still appears (zeros).
     */
    public List<ReportDtos.RoomTypeRow> roomTypePerformance(UUID hotelId, LocalDate from, LocalDate to) {
        Map<UUID, long[]> stays = new HashMap<>();
        Map<UUID, BigDecimal> revenue = new HashMap<>();
        Map<UUID, String> names = new java.util.LinkedHashMap<>();
        jdbc.sql("SELECT id, name FROM room_types WHERE hotel_id = :hotel ORDER BY sort_order, name")
                .param("hotel", Uuids.param(hotelId))
                .query((rs, i) -> {
                    names.put(Uuids.fromBytes(rs.getBytes("id")), rs.getString("name"));
                    return null;
                }).list();
        jdbc.sql("""
                        SELECT room_type_id, check_in, check_out, rooms, subtotal FROM hotel_reservations
                        WHERE hotel_id = :hotel AND status IN (:statuses) AND check_in <= :to AND check_out > :from""")
                .param("hotel", Uuids.param(hotelId))
                .param("statuses", REVENUE_STATUSES)
                .param("from", from)
                .param("to", to)
                .query((rs, i) -> {
                    UUID type = Uuids.fromBytes(rs.getBytes("room_type_id"));
                    LocalDate checkIn = rs.getObject("check_in", LocalDate.class);
                    int stayNights = (int) ChronoUnit.DAYS.between(checkIn, rs.getObject("check_out", LocalDate.class));
                    BigDecimal subtotal = rs.getBigDecimal("subtotal");
                    int rooms = rs.getInt("rooms");
                    long[] counts = stays.computeIfAbsent(type, id -> new long[2]);
                    counts[0]++;
                    for (int n = 0; n < stayNights; n++) {
                        LocalDate night = checkIn.plusDays(n);
                        if (!night.isBefore(from) && !night.isAfter(to)) {
                            counts[1] += rooms;
                            revenue.merge(type, nightShare(subtotal, stayNights, n), BigDecimal::add);
                        }
                    }
                    return null;
                }).list();
        BigDecimal total = revenue.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        List<ReportDtos.RoomTypeRow> rows = new ArrayList<>();
        names.forEach((id, name) -> {
            long[] counts = stays.getOrDefault(id, new long[2]);
            BigDecimal money = revenue.getOrDefault(id, BigDecimal.ZERO);
            rows.add(new ReportDtos.RoomTypeRow(id, name, counts[0], counts[1], money(money),
                    counts[1] == 0 ? BigDecimal.ZERO.setScale(2)
                            : money.divide(BigDecimal.valueOf(counts[1]), 2, RoundingMode.HALF_UP),
                    total.signum() == 0 ? BigDecimal.ZERO.setScale(1)
                            : money.multiply(HUNDRED).divide(total, 1, RoundingMode.HALF_UP)));
        });
        return rows;
    }

    // ------------------------------------------------------------------ counts

    /** Paid reservations booked (created) on the days [from, to] in {@code zone}. */
    public long reservationsBooked(UUID hotelId, LocalDate from, LocalDate to, ZoneId zone) {
        return jdbc.sql("""
                        SELECT COUNT(*) FROM hotel_reservations WHERE hotel_id = :hotel AND status IN (:statuses)
                          AND created_at >= :from AND created_at < :to""")
                .param("hotel", Uuids.param(hotelId))
                .param("statuses", PAID_STATUSES)
                .param("from", utc(from, zone))
                .param("to", utc(to.plusDays(1), zone))
                .query(Long.class).single();
    }

    /** Reservations cancelled (by the customer or the hotel) on the days [from, to] in {@code zone}. */
    public long cancellations(UUID hotelId, LocalDate from, LocalDate to, ZoneId zone) {
        return jdbc.sql("""
                        SELECT COUNT(*) FROM hotel_reservations WHERE hotel_id = :hotel AND status = 'CANCELLED'
                          AND cancelled_at >= :from AND cancelled_at < :to""")
                .param("hotel", Uuids.param(hotelId))
                .param("from", utc(from, zone))
                .param("to", utc(to.plusDays(1), zone))
                .query(Long.class).single();
    }

    /**
     * Today at the front desk: arrivals (check-in today, confirmed or already checked in), departures (check-out
     * today, checked in or already checked out) and guests in house (checked in); then (Phase 11) the people
     * (adults + children) of the arrivals, of the departures and in house, and the rooms in house.
     */
    public long[] frontDeskToday(UUID hotelId, LocalDate today) {
        return jdbc.sql("""
                        SELECT COALESCE(SUM(check_in = :today AND status IN ('CONFIRMED', 'CHECKED_IN')), 0) AS arrivals,
                               COALESCE(SUM(check_out = :today AND status IN ('CHECKED_IN', 'CHECKED_OUT')), 0) AS departures,
                               COALESCE(SUM(status = 'CHECKED_IN'), 0) AS in_house,
                               COALESCE(SUM(IF(check_in = :today AND status IN ('CONFIRMED', 'CHECKED_IN'),
                                   adults + children, 0)), 0) AS arriving_guests,
                               COALESCE(SUM(IF(check_out = :today AND status IN ('CHECKED_IN', 'CHECKED_OUT'),
                                   adults + children, 0)), 0) AS departing_guests,
                               COALESCE(SUM(IF(status = 'CHECKED_IN', adults + children, 0)), 0) AS in_house_guests,
                               COALESCE(SUM(IF(status = 'CHECKED_IN', rooms, 0)), 0) AS in_house_rooms
                        FROM hotel_reservations WHERE hotel_id = :hotel""")
                .param("hotel", Uuids.param(hotelId))
                .param("today", today)
                .query((rs, i) -> new long[] {rs.getLong("arrivals"), rs.getLong("departures"), rs.getLong("in_house"),
                        rs.getLong("arriving_guests"), rs.getLong("departing_guests"), rs.getLong("in_house_guests"),
                        rs.getLong("in_house_rooms")})
                .single();
    }

    // ------------------------------------------------------------------ per India day (Phase 11 trends)

    /**
     * Paid reservations booked per India day of [from, to] (as {@link #reservationsBooked}): {booked, of those
     * cancelled since}.
     */
    public Map<LocalDate, long[]> reservationsByDay(UUID hotelId, LocalDate from, LocalDate to) {
        Map<LocalDate, long[]> days = new HashMap<>();
        jdbc.sql("""
                        SELECT DATE(CONVERT_TZ(created_at, '+00:00', '+05:30')) AS day, COUNT(*) AS booked,
                               SUM(status = 'CANCELLED') AS cancelled
                        FROM hotel_reservations WHERE hotel_id = :hotel AND status IN (:statuses)
                          AND created_at >= :from AND created_at < :to
                        GROUP BY day""")
                .param("hotel", Uuids.param(hotelId))
                .param("statuses", PAID_STATUSES)
                .param("from", utc(from, ReportRanges.INDIA))
                .param("to", utc(to.plusDays(1), ReportRanges.INDIA))
                .query((rs, i) -> days.put(rs.getObject("day", LocalDate.class),
                        new long[] {rs.getLong("booked"), rs.getLong("cancelled")}))
                .list();
        return days;
    }

    /** Reservations cancelled per India day of [from, to] (as {@link #cancellations}): {all, by the hotel}. */
    public Map<LocalDate, long[]> cancellationsByDay(UUID hotelId, LocalDate from, LocalDate to) {
        Map<LocalDate, long[]> days = new HashMap<>();
        jdbc.sql("""
                        SELECT DATE(CONVERT_TZ(cancelled_at, '+00:00', '+05:30')) AS day, COUNT(*) AS cancelled,
                               SUM(cancelled_by = 'HOTEL') AS by_hotel
                        FROM hotel_reservations WHERE hotel_id = :hotel AND status = 'CANCELLED'
                          AND cancelled_at >= :from AND cancelled_at < :to
                        GROUP BY day""")
                .param("hotel", Uuids.param(hotelId))
                .param("from", utc(from, ReportRanges.INDIA))
                .param("to", utc(to.plusDays(1), ReportRanges.INDIA))
                .query((rs, i) -> days.put(rs.getObject("day", LocalDate.class),
                        new long[] {rs.getLong("cancelled"), rs.getLong("by_hotel")}))
                .list();
        return days;
    }

    /** The hotel's approved reviews, approved up to the end of the India day {@code to}, oldest first. */
    public List<ApprovedReview> approvedReviews(UUID hotelId, LocalDate to) {
        return jdbc.sql("""
                        SELECT DATE(CONVERT_TZ(moderated_at, '+00:00', '+05:30')) AS day, rating FROM reviews
                        WHERE hotel_id = :hotel AND status = 'APPROVED' AND moderated_at < :to
                        ORDER BY moderated_at""")
                .param("hotel", Uuids.param(hotelId))
                .param("to", utc(to.plusDays(1), ReportRanges.INDIA))
                .query((rs, i) -> new ApprovedReview(rs.getObject("day", LocalDate.class), rs.getInt("rating")))
                .list();
    }

    /** The seed figures, the rating now and the reviews waiting for moderation. */
    public HotelRating rating(UUID hotelId) {
        return jdbc.sql("""
                        SELECT h.seed_rating, h.seed_review_count, h.avg_rating, h.review_count,
                               (SELECT COUNT(*) FROM reviews r WHERE r.hotel_id = h.id AND r.status = 'PENDING') AS pending
                        FROM hotels h WHERE h.id = :hotel""")
                .param("hotel", Uuids.param(hotelId))
                .query((rs, i) -> new HotelRating(rs.getBigDecimal("seed_rating"), rs.getInt("seed_review_count"),
                        rs.getBigDecimal("avg_rating"), rs.getLong("review_count"), rs.getLong("pending")))
                .single();
    }

    /** A review approved on an India day (the day it started to count for the rating). */
    public record ApprovedReview(LocalDate day, int rating) {
    }

    public record HotelRating(BigDecimal seedRating, int seedReviews, BigDecimal guestRating, long reviewCount,
            long pendingReviews) {
    }

    // ------------------------------------------------------------------ rows and totals

    public static List<OccupancyNight> occupancyRows(Map<LocalDate, Occupancy> nights, LocalDate from, LocalDate to) {
        List<OccupancyNight> rows = new ArrayList<>();
        for (LocalDate night = from; !night.isAfter(to); night = night.plusDays(1)) {
            Occupancy occupancy = nights.getOrDefault(night, Occupancy.NONE);
            rows.add(new OccupancyNight(night, occupancy.roomNights(), occupancy.booked(),
                    percent(occupancy.booked(), occupancy.roomNights())));
        }
        return rows;
    }

    public static OccupancyTotals occupancyTotals(List<OccupancyNight> rows) {
        long roomNights = rows.stream().mapToLong(OccupancyNight::roomNights).sum();
        long booked = rows.stream().mapToLong(OccupancyNight::bookedRoomNights).sum();
        return new OccupancyTotals(roomNights, booked, percent(booked, roomNights));
    }

    public static List<RevenueNight> revenueRows(Map<LocalDate, NightRevenue> nights, LocalDate from, LocalDate to) {
        List<RevenueNight> rows = new ArrayList<>();
        for (LocalDate night = from; !night.isAfter(to); night = night.plusDays(1)) {
            NightRevenue revenue = nights.getOrDefault(night, new NightRevenue());
            rows.add(new RevenueNight(night, revenue.roomNights, money(revenue.amount),
                    averageRate(revenue.amount, revenue.roomNights)));
        }
        return rows;
    }

    public static RevenueTotals revenueTotals(List<RevenueNight> rows) {
        long roomNights = rows.stream().mapToLong(RevenueNight::roomNights).sum();
        BigDecimal revenue = rows.stream().map(RevenueNight::revenue).reduce(BigDecimal.ZERO, BigDecimal::add);
        return new RevenueTotals(roomNights, money(revenue), averageRate(revenue, roomNights));
    }

    /** One decimal; 0.0 when there is nothing to divide by. */
    public static BigDecimal percent(long part, long whole) {
        return whole == 0 ? BigDecimal.ZERO.setScale(1)
                : BigDecimal.valueOf(part).multiply(HUNDRED).divide(BigDecimal.valueOf(whole), 1, RoundingMode.HALF_UP);
    }

    static BigDecimal averageRate(BigDecimal revenue, long roomNights) {
        return roomNights == 0 ? money(BigDecimal.ZERO)
                : revenue.divide(BigDecimal.valueOf(roomNights), 2, RoundingMode.HALF_UP);
    }

    static BigDecimal money(BigDecimal amount) {
        return amount.setScale(2, RoundingMode.HALF_UP);
    }

    /** Night {@code index} (0-based) of a stay's room charges: an even share, the last night takes the remainder. */
    static BigDecimal nightShare(BigDecimal subtotal, int nights, int index) {
        BigDecimal even = subtotal.divide(BigDecimal.valueOf(nights), 2, RoundingMode.DOWN);
        return index == nights - 1 ? subtotal.subtract(even.multiply(BigDecimal.valueOf(nights - 1L))) : even;
    }

    /** Midnight of a day in {@code zone} as the UTC wall-clock time stored in DATETIME columns. */
    static LocalDateTime utc(LocalDate day, ZoneId zone) {
        return LocalDateTime.ofInstant(day.atStartOfDay(zone).toInstant(), ZoneOffset.UTC);
    }

    public record Occupancy(long roomNights, long booked) {
        static final Occupancy NONE = new Occupancy(0, 0);
    }

    /** Running total of one night. */
    public static final class NightRevenue {
        private long roomNights;
        private BigDecimal amount = BigDecimal.ZERO;

        void add(int rooms, BigDecimal share) {
            roomNights += rooms;
            amount = amount.add(share);
        }

        public long roomNights() {
            return roomNights;
        }

        public BigDecimal amount() {
            return amount;
        }
    }
}
