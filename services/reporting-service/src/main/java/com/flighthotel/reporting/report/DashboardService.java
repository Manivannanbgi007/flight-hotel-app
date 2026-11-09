package com.flighthotel.reporting.report;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.analytics.Change;
import com.flighthotel.common.analytics.Interval;
import com.flighthotel.common.analytics.Interval.Bucket;
import com.flighthotel.common.analytics.Timeline;

/**
 * The admin dashboard (API_DOCUMENTATION.md section 14.1, v2 of Phase 11) and the home page's public figures,
 * calculated from the facts for the requested range. A booking counts as <em>paid</em> once it was confirmed
 * ({@code confirmed_at} set): a payment whose booking then failed at the hotel or airline was refunded and is no
 * booking. Money: {@code gross} is what was captured in the range, {@code refunds} what went back in the range (any
 * reason), {@code net} the difference.
 * <p>
 * Every additive figure is first summed per India day ({@link DayFigures}) over the range and the previous period of
 * the same length; the range's totals, the trend series (any {@link Interval}) and the comparison with the previous
 * period are all sums of those days, so they always agree with each other.
 */
@Service
@Transactional(readOnly = true)
public class DashboardService {

    /** India day of a UTC DATETIME column (India has no daylight saving time). */
    static final String INDIA_DAY = "DATE(CONVERT_TZ(%s, '+00:00', '+05:30'))";
    private static final String IN_RANGE = " >= :start AND %s < :end";
    static final List<String> INITIATORS = List.of("CUSTOMER", "SUPPORT_AGENT", "ADMIN", "HOTEL");

    private final JdbcClient jdbc;
    private final Clock clock;
    private final int publicDays;

    public DashboardService(JdbcClient jdbc, Clock clock, @Value("${reporting.public-days:90}") int publicDays) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.publicDays = publicDays;
    }

    /** {@code active}: customers with at least one paid booking created in the range (each counted once). */
    public record Customers(long total, long newInRange, long active) {
    }

    public record Bookings(long flight, long hotel, long upcoming, long completed, long cancelled, long pending,
            long failed) {
    }

    /** {@code failed*}, {@code successRate}: Phase 11 (failed attempts show the booking's amount). */
    public record Payments(long pendingCount, BigDecimal pendingAmount, long successfulCount,
            BigDecimal successfulAmount, long failedCount, BigDecimal failedAmount, BigDecimal successRate) {
    }

    public record Revenue(BigDecimal gross, BigDecimal refunds, BigDecimal net, String currency) {
    }

    /** {@code previousBookings}: the same city's paid bookings in the previous period of the same length (the trend). */
    public record Destination(String city, long bookings, BigDecimal revenue, long previousBookings) {
    }

    /** {@code previousBookings}: the same hotel's paid bookings in the previous period of the same length. */
    public record TopHotel(String hotelId, String hotelName, String city, long bookings, BigDecimal revenue,
            long previousBookings) {
    }

    public record BookingDay(LocalDate date, long flight, long hotel, long cancelled) {
    }

    public record RevenueDay(LocalDate date, BigDecimal gross, BigDecimal refunds, BigDecimal net) {
    }

    /** {@code customerName} is null when the account is not known to reporting yet; the e-mail is the booking's contact. */
    public record RecentBooking(String id, String reference, String type, String status, String title,
            BigDecimal totalAmount, Instant createdAt, String customerName, String customerEmail,
            String destination) {
    }

    /**
     * One thing that happened, from the facts: {@code type} is CUSTOMER_REGISTERED, BOOKING_CREATED, BOOKING_CANCELLED,
     * PAYMENT_SUCCEEDED, PAYMENT_FAILED, REFUND_* or SUPPORT_TICKET; {@code outcome} is SUCCESS, PENDING, FAILED,
     * CANCELLED or INFO, so the UI never has to guess a colour. {@code amount} is null when there is none.
     */
    public record TimelineEvent(Instant at, String type, String outcome, String title, String detail, BigDecimal amount,
            String entityType, String entityId) {
    }

    public record Activity(Instant occurredAt, String action, String entityType, String entityId, String service,
            String actorRole) {
    }

    /**
     * One product (or all of them) for the range.
     *
     * @param bookings         paid bookings created in the range
     * @param cancelled        of those, cancelled since
     * @param cancellationRate cancelled / bookings × 100 (one decimal)
     * @param gross            captured in the range
     * @param refunds          refunds completed in the range
     * @param net              gross − refunds
     */
    public record Product(long bookings, long cancelled, BigDecimal cancellationRate, BigDecimal gross,
            BigDecimal refunds, BigDecimal net) {
    }

    /** {@code all} also holds money of bookings whose snapshot has not arrived yet (seconds), so it may exceed the sum. */
    public record Products(Product hotel, Product flight, Product all) {
    }

    /**
     * Cancellations the hotel or airline confirmed in the range, and the cancellation rate of the range's paid bookings.
     *
     * @param byInitiator CUSTOMER, SUPPORT_AGENT, ADMIN, HOTEL (always all four keys)
     * @param rate        of the paid bookings created in the range, the share cancelled since (%)
     */
    public record Cancellations(long count, long hotel, long flight, Map<String, Long> byInitiator,
            BigDecimal cancellationFees, BigDecimal refundAmount, BigDecimal rate, BigDecimal hotelRate,
            BigDecimal flightRate) {
    }

    /** One point of the trend: the sums of the days of the bucket (definitions as for the range). */
    public record SeriesPoint(String key, LocalDate start, LocalDate end, long bookings, long hotelBookings,
            long flightBookings, long cancellations, BigDecimal gross, BigDecimal refunds, BigDecimal net,
            BigDecimal hotelGross, BigDecimal flightGross, BigDecimal hotelNet, BigDecimal flightNet,
            long successfulPayments, long failedPayments, BigDecimal failedAmount, long newCustomers) {
    }

    /**
     * The range against the previous period of the same length ({@code previousRange}). Rates: {@code change} in
     * percentage points.
     */
    public record Comparison(Change bookings, Change hotelBookings, Change flightBookings, Change grossRevenue,
            Change refunds, Change netRevenue, Change hotelRevenue, Change flightRevenue, Change successfulPayments,
            Change failedPayments, Change cancellations, Change cancellationRate, Change newCustomers) {
    }

    public record Dashboard(ReportRange range, Customers customers, Bookings bookings, Payments payments,
            Revenue revenue, List<Destination> popularDestinations, List<TopHotel> topHotels,
            List<BookingDay> bookingTrend, List<RevenueDay> revenueTrend, List<RecentBooking> recentBookings,
            List<Activity> recentActivity, Instant generatedAt,
            // ---- Phase 11 (v2)
            Interval interval, ReportRange previousRange, Products products, Cancellations cancellations,
            Comparison comparison, List<SeriesPoint> series,
            // ---- Phase 12: the unified activity feed
            List<TimelineEvent> timeline) {
    }

    public record PopularDestination(String city, long bookings) {
    }

    public record PopularRoute(String origin, String destination, String originCity, String destinationCity,
            long bookings) {
    }

    @PreAuthorize("hasAuthority('REPORT_VIEW')")
    public Dashboard dashboard(ReportRange range, Interval interval) {
        Map<String, Object> p = Map.of("start", range.startUtc(), "end", range.endUtc());
        ReportRange previous = range.previous();
        Map<LocalDate, DayFigures> days = dayFigures(previous.startUtc(), range.endUtc());
        DayFigures now = DayFigures.sum(days, range.from(), range.to());
        DayFigures before = DayFigures.sum(days, previous.from(), previous.to());

        long active = jdbc.sql("""
                        SELECT COUNT(DISTINCT user_id) FROM booking_facts
                        WHERE confirmed_at IS NOT NULL AND created_at >= :start AND created_at < :end""")
                .params(p).query(Long.class).single();
        Customers customers = jdbc.sql("""
                        SELECT COUNT(*) AS total, COALESCE(SUM(registered_at >= :start), 0) AS added
                        FROM user_facts WHERE FIND_IN_SET('CUSTOMER', roles) > 0 AND registered_at < :end""")
                .params(p).query((rs, i) -> new Customers(rs.getLong("total"), rs.getLong("added"), active)).single();

        Map<String, Object> b = jdbc.sql("""
                        SELECT COALESCE(SUM(confirmed_at IS NOT NULL AND booking_type = 'FLIGHT'), 0) AS flight,
                            COALESCE(SUM(confirmed_at IS NOT NULL AND booking_type = 'HOTEL'), 0) AS hotel,
                            COALESCE(SUM(confirmed_at IS NOT NULL AND status IN ('CONFIRMED', 'CANCELLATION_PENDING')),
                                0) AS upcoming,
                            COALESCE(SUM(confirmed_at IS NOT NULL AND status = 'COMPLETED'), 0) AS completed,
                            COALESCE(SUM(confirmed_at IS NOT NULL AND cancelled_at IS NOT NULL), 0) AS cancelled,
                            COALESCE(SUM(status IN ('INITIATED', 'PENDING_PAYMENT', 'PAYMENT_SUCCESS',
                                'SUPPLIER_PENDING')), 0) AS pending,
                            COALESCE(SUM(status IN ('FAILED', 'EXPIRED')), 0) AS failed,
                            COALESCE(SUM(status = 'PENDING_PAYMENT'), 0) AS awaiting,
                            COALESCE(SUM(IF(status = 'PENDING_PAYMENT', total_amount, 0)), 0) AS awaiting_amount
                        FROM booking_facts WHERE created_at""" + IN_RANGE.formatted("created_at"))
                .params(p).query().singleRow();
        Bookings bookings = new Bookings(n(b, "flight"), n(b, "hotel"), n(b, "upcoming"), n(b, "completed"),
                n(b, "cancelled"), n(b, "pending"), n(b, "failed"));

        BigDecimal gross = money(now.gross);
        BigDecimal refunds = money(now.refunds);
        Payments payments = new Payments(n(b, "awaiting"), money(b.get("awaiting_amount")), now.succeeded, gross,
                now.failed, money(now.failedAmount), Change.percent(now.succeeded, now.succeeded + now.failed));
        Revenue revenue = new Revenue(gross, refunds, gross.subtract(refunds), "INR");

        List<Destination> destinations = jdbc.sql("""
                        SELECT destination, COUNT(*) AS bookings, SUM(total_amount - refunded_amount) AS revenue
                        FROM booking_facts
                        WHERE confirmed_at IS NOT NULL AND destination IS NOT NULL AND created_at >= :start
                            AND created_at < :end
                        GROUP BY destination ORDER BY bookings DESC, revenue DESC, destination LIMIT 5""")
                .params(p).query((rs, i) -> new Destination(rs.getString("destination"), rs.getLong("bookings"),
                        money(rs.getBigDecimal("revenue")), 0)).list();
        Map<String, Long> citiesBefore = previousCounts("""
                SELECT destination AS k, COUNT(*) AS n FROM booking_facts
                WHERE confirmed_at IS NOT NULL AND destination IN (:keys) AND created_at >= :start AND created_at < :end
                GROUP BY destination""", destinations.stream().map(Destination::city).toList(), previous);
        destinations = destinations.stream().map(d -> new Destination(d.city(), d.bookings(), d.revenue(),
                citiesBefore.getOrDefault(d.city(), 0L))).toList();
        List<TopHotel> hotels = jdbc.sql("""
                        SELECT BIN_TO_UUID(hotel_id) AS hotel_id, MAX(title) AS name, MAX(destination) AS city,
                            COUNT(*) AS bookings, SUM(total_amount - refunded_amount) AS revenue
                        FROM booking_facts
                        WHERE booking_type = 'HOTEL' AND hotel_id IS NOT NULL AND confirmed_at IS NOT NULL
                            AND created_at >= :start AND created_at < :end
                        GROUP BY hotel_id ORDER BY revenue DESC, bookings DESC LIMIT 5""")
                .params(p).query((rs, i) -> new TopHotel(rs.getString("hotel_id"), rs.getString("name"),
                        rs.getString("city"), rs.getLong("bookings"), money(rs.getBigDecimal("revenue")), 0)).list();
        Map<String, Long> hotelsBefore = previousCounts("""
                SELECT BIN_TO_UUID(hotel_id) AS k, COUNT(*) AS n FROM booking_facts
                WHERE booking_type = 'HOTEL' AND confirmed_at IS NOT NULL AND hotel_id IN (:keys)
                    AND created_at >= :start AND created_at < :end
                GROUP BY hotel_id""", hotels.stream().map(TopHotel::hotelId).toList(), previous, true);
        hotels = hotels.stream().map(h -> new TopHotel(h.hotelId(), h.hotelName(), h.city(), h.bookings(), h.revenue(),
                hotelsBefore.getOrDefault(h.hotelId(), 0L))).toList();

        List<BookingDay> bookingTrend = range.days().stream().map(day -> {
            DayFigures f = days.getOrDefault(day, DayFigures.NONE);
            return new BookingDay(day, f.flightBookings, f.hotelBookings, f.hotelCancellations + f.flightCancellations
                    + f.otherCancellations);
        }).toList();
        List<RevenueDay> revenueTrend = range.days().stream().map(day -> {
            DayFigures f = days.getOrDefault(day, DayFigures.NONE);
            return new RevenueDay(day, money(f.gross), money(f.refunds), money(f.gross.subtract(f.refunds)));
        }).toList();

        return new Dashboard(range, customers, bookings, payments, revenue, destinations, hotels, bookingTrend,
                revenueTrend, recentBookings(p), recentActivity(p), clock.instant(),
                interval, previous, products(now), cancellations(now, p), comparison(now, before),
                series(Timeline.of(range.toDayRange(), interval), days), timeline(p));
    }

    /** Paid bookings per key (city or hotel) in the previous period; a key without any is simply missing. */
    private Map<String, Long> previousCounts(String sql, List<String> keys, ReportRange previous) {
        return previousCounts(sql, keys, previous, false);
    }

    private Map<String, Long> previousCounts(String sql, List<String> keys, ReportRange previous, boolean uuids) {
        Map<String, Long> counts = new HashMap<>();
        if (keys.isEmpty()) {
            return counts;
        }
        List<Object> values = uuids ? keys.stream().map(DashboardService::uuidBytes).collect(java.util.stream.Collectors.toList())
                : new ArrayList<>(keys);
        jdbc.sql(sql).param("keys", values).param("start", previous.startUtc()).param("end", previous.endUtc())
                .query((ResultSet rs) -> {
                    counts.put(rs.getString("k"), rs.getLong("n"));
                });
        return counts;
    }

    private static byte[] uuidBytes(String uuid) {
        java.util.UUID id = java.util.UUID.fromString(uuid);
        java.nio.ByteBuffer buffer = java.nio.ByteBuffer.allocate(16);
        buffer.putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits());
        return buffer.array();
    }

    // ------------------------------------------------------------------ Phase 11 figures

    private static Products products(DayFigures f) {
        Product hotel = product(f.hotelBookings, f.hotelCancelled, f.hotelGross, f.hotelRefunds);
        Product flight = product(f.flightBookings, f.flightCancelled, f.flightGross, f.flightRefunds);
        Product all = product(f.hotelBookings + f.flightBookings, f.hotelCancelled + f.flightCancelled, f.gross,
                f.refunds);
        return new Products(hotel, flight, all);
    }

    private static Product product(long bookings, long cancelled, BigDecimal gross, BigDecimal refunds) {
        return new Product(bookings, cancelled, Change.percent(cancelled, bookings), money(gross), money(refunds),
                money(gross.subtract(refunds)));
    }

    private Cancellations cancellations(DayFigures f, Map<String, Object> p) {
        Map<String, Long> byInitiator = new LinkedHashMap<>();
        INITIATORS.forEach(who -> byInitiator.put(who, 0L));
        BigDecimal[] money = {BigDecimal.ZERO, BigDecimal.ZERO};
        jdbc.sql("SELECT initiated_by, COUNT(*) AS n, SUM(cancellation_fee) AS fees, SUM(refund_amount) AS refunds "
                        + "FROM cancellation_facts WHERE cancelled_at" + IN_RANGE.formatted("cancelled_at")
                        + " GROUP BY initiated_by")
                .params(p).query((ResultSet rs) -> {
                    byInitiator.merge(rs.getString("initiated_by"), rs.getLong("n"), Long::sum);
                    money[0] = money[0].add(rs.getBigDecimal("fees"));
                    money[1] = money[1].add(rs.getBigDecimal("refunds"));
                });
        long paid = f.hotelBookings + f.flightBookings;
        return new Cancellations(f.hotelCancellations + f.flightCancellations + f.otherCancellations,
                f.hotelCancellations, f.flightCancellations, byInitiator, money(money[0]), money(money[1]),
                Change.percent(f.hotelCancelled + f.flightCancelled, paid),
                Change.percent(f.hotelCancelled, f.hotelBookings), Change.percent(f.flightCancelled, f.flightBookings));
    }

    private static Comparison comparison(DayFigures now, DayFigures before) {
        return new Comparison(
                Change.of(now.hotelBookings + now.flightBookings, before.hotelBookings + before.flightBookings),
                Change.of(now.hotelBookings, before.hotelBookings),
                Change.of(now.flightBookings, before.flightBookings),
                Change.of(money(now.gross), money(before.gross)),
                Change.of(money(now.refunds), money(before.refunds)),
                Change.of(money(now.gross.subtract(now.refunds)), money(before.gross.subtract(before.refunds))),
                Change.of(money(now.hotelGross.subtract(now.hotelRefunds)),
                        money(before.hotelGross.subtract(before.hotelRefunds))),
                Change.of(money(now.flightGross.subtract(now.flightRefunds)),
                        money(before.flightGross.subtract(before.flightRefunds))),
                Change.of(now.succeeded, before.succeeded),
                Change.of(now.failed, before.failed),
                Change.of(now.hotelCancellations + now.flightCancellations + now.otherCancellations,
                        before.hotelCancellations + before.flightCancellations + before.otherCancellations),
                Change.of(Change.percent(now.hotelCancelled + now.flightCancelled,
                                now.hotelBookings + now.flightBookings),
                        Change.percent(before.hotelCancelled + before.flightCancelled,
                                before.hotelBookings + before.flightBookings)),
                Change.of(now.newCustomers, before.newCustomers));
    }

    private static List<SeriesPoint> series(Timeline timeline, Map<LocalDate, DayFigures> days) {
        List<SeriesPoint> points = new ArrayList<>();
        for (Bucket bucket : timeline.buckets()) {
            DayFigures f = DayFigures.sum(days, bucket.start(), bucket.end());
            points.add(new SeriesPoint(bucket.key(), bucket.start(), bucket.end(), f.hotelBookings + f.flightBookings,
                    f.hotelBookings, f.flightBookings, f.hotelCancellations + f.flightCancellations
                            + f.otherCancellations,
                    money(f.gross), money(f.refunds), money(f.gross.subtract(f.refunds)), money(f.hotelGross),
                    money(f.flightGross), money(f.hotelGross.subtract(f.hotelRefunds)),
                    money(f.flightGross.subtract(f.flightRefunds)), f.succeeded, f.failed, money(f.failedAmount),
                    f.newCustomers));
        }
        return points;
    }

    /**
     * The additive figures of every India day in [start, end): paid bookings by creation day (and of those the ones
     * cancelled since), money captured, refunded and failed by the day it happened (by product through the booking),
     * cancellations by the day the hotel or airline confirmed them, new customer accounts by registration day.
     */
    private Map<LocalDate, DayFigures> dayFigures(LocalDateTime start, LocalDateTime end) {
        Map<LocalDate, DayFigures> days = new HashMap<>();
        Map<String, Object> p = Map.of("start", start, "end", end);
        jdbc.sql("SELECT " + INDIA_DAY.formatted("created_at") + """
                         AS day,
                            SUM(booking_type = 'HOTEL') AS hotel, SUM(booking_type = 'FLIGHT') AS flight,
                            SUM(booking_type = 'HOTEL' AND cancelled_at IS NOT NULL) AS hotel_cancelled,
                            SUM(booking_type = 'FLIGHT' AND cancelled_at IS NOT NULL) AS flight_cancelled
                        FROM booking_facts WHERE confirmed_at IS NOT NULL AND created_at""" + IN_RANGE.formatted(
                        "created_at") + " GROUP BY day")
                .params(p).query((ResultSet rs) -> {
                    DayFigures f = day(days, rs);
                    f.hotelBookings = rs.getLong("hotel");
                    f.flightBookings = rs.getLong("flight");
                    f.hotelCancelled = rs.getLong("hotel_cancelled");
                    f.flightCancelled = rs.getLong("flight_cancelled");
                });
        jdbc.sql("SELECT " + INDIA_DAY.formatted("p.occurred_at") + """
                         AS day,
                            SUM(p.status = 'SUCCESS') AS succeeded,
                            SUM(IF(p.status = 'SUCCESS', p.amount, 0)) AS gross,
                            SUM(IF(p.status = 'SUCCESS' AND b.booking_type = 'HOTEL', p.amount, 0)) AS hotel_gross,
                            SUM(IF(p.status = 'SUCCESS' AND b.booking_type = 'FLIGHT', p.amount, 0)) AS flight_gross,
                            SUM(p.status = 'FAILED') AS failed,
                            SUM(IF(p.status = 'FAILED', COALESCE(p.amount, b.total_amount, 0), 0)) AS failed_amount
                        FROM payment_facts p LEFT JOIN booking_facts b ON b.booking_id = p.booking_id
                        WHERE p.occurred_at""" + IN_RANGE.formatted("p.occurred_at") + " GROUP BY day")
                .params(p).query((ResultSet rs) -> {
                    DayFigures f = day(days, rs);
                    f.succeeded = rs.getLong("succeeded");
                    f.gross = rs.getBigDecimal("gross");
                    f.hotelGross = rs.getBigDecimal("hotel_gross");
                    f.flightGross = rs.getBigDecimal("flight_gross");
                    f.failed = rs.getLong("failed");
                    f.failedAmount = rs.getBigDecimal("failed_amount");
                });
        jdbc.sql("SELECT " + INDIA_DAY.formatted("r.completed_at") + """
                         AS day, SUM(r.amount) AS refunds,
                            SUM(IF(b.booking_type = 'HOTEL', r.amount, 0)) AS hotel_refunds,
                            SUM(IF(b.booking_type = 'FLIGHT', r.amount, 0)) AS flight_refunds
                        FROM refund_facts r LEFT JOIN booking_facts b ON b.booking_id = r.booking_id
                        WHERE r.status = 'COMPLETED' AND r.completed_at""" + IN_RANGE.formatted("r.completed_at")
                        + " GROUP BY day")
                .params(p).query((ResultSet rs) -> {
                    DayFigures f = day(days, rs);
                    f.refunds = rs.getBigDecimal("refunds");
                    f.hotelRefunds = rs.getBigDecimal("hotel_refunds");
                    f.flightRefunds = rs.getBigDecimal("flight_refunds");
                });
        jdbc.sql("SELECT " + INDIA_DAY.formatted("cancelled_at") + """
                         AS day, SUM(booking_type = 'HOTEL') AS hotel, SUM(booking_type = 'FLIGHT') AS flight,
                            SUM(booking_type NOT IN ('HOTEL', 'FLIGHT')) AS other
                        FROM cancellation_facts WHERE cancelled_at""" + IN_RANGE.formatted("cancelled_at")
                        + " GROUP BY day")
                .params(p).query((ResultSet rs) -> {
                    DayFigures f = day(days, rs);
                    f.hotelCancellations = rs.getLong("hotel");
                    f.flightCancellations = rs.getLong("flight");
                    f.otherCancellations = rs.getLong("other");
                });
        jdbc.sql("SELECT " + INDIA_DAY.formatted("registered_at") + " AS day, COUNT(*) AS added FROM user_facts "
                        + "WHERE FIND_IN_SET('CUSTOMER', roles) > 0 AND registered_at"
                        + IN_RANGE.formatted("registered_at") + " GROUP BY day")
                .params(p).query((ResultSet rs) -> {
                    day(days, rs).newCustomers = rs.getLong("added");
                });
        return days;
    }

    private static DayFigures day(Map<LocalDate, DayFigures> days, ResultSet rs) throws SQLException {
        return days.computeIfAbsent(rs.getObject("day", LocalDate.class), d -> new DayFigures());
    }

    /** The additive figures of one India day (or the sum of several). */
    static final class DayFigures {
        static final DayFigures NONE = new DayFigures();

        long hotelBookings;
        long flightBookings;
        long hotelCancelled;
        long flightCancelled;
        long succeeded;
        BigDecimal gross = BigDecimal.ZERO;
        BigDecimal hotelGross = BigDecimal.ZERO;
        BigDecimal flightGross = BigDecimal.ZERO;
        long failed;
        BigDecimal failedAmount = BigDecimal.ZERO;
        BigDecimal refunds = BigDecimal.ZERO;
        BigDecimal hotelRefunds = BigDecimal.ZERO;
        BigDecimal flightRefunds = BigDecimal.ZERO;
        long hotelCancellations;
        long flightCancellations;
        long otherCancellations;
        long newCustomers;

        static DayFigures sum(Map<LocalDate, DayFigures> days, LocalDate from, LocalDate to) {
            DayFigures total = new DayFigures();
            for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
                DayFigures f = days.get(day);
                if (f != null) {
                    total.add(f);
                }
            }
            return total;
        }

        private void add(DayFigures f) {
            hotelBookings += f.hotelBookings;
            flightBookings += f.flightBookings;
            hotelCancelled += f.hotelCancelled;
            flightCancelled += f.flightCancelled;
            succeeded += f.succeeded;
            gross = gross.add(f.gross);
            hotelGross = hotelGross.add(f.hotelGross);
            flightGross = flightGross.add(f.flightGross);
            failed += f.failed;
            failedAmount = failedAmount.add(f.failedAmount);
            refunds = refunds.add(f.refunds);
            hotelRefunds = hotelRefunds.add(f.hotelRefunds);
            flightRefunds = flightRefunds.add(f.flightRefunds);
            hotelCancellations += f.hotelCancellations;
            flightCancellations += f.flightCancellations;
            otherCancellations += f.otherCancellations;
            newCustomers += f.newCustomers;
        }
    }

    // ------------------------------------------------------------------ lists

    private List<RecentBooking> recentBookings(Map<String, Object> p) {
        return jdbc.sql("""
                        SELECT BIN_TO_UUID(b.booking_id) AS id, b.booking_reference, b.booking_type, b.status, b.title,
                            b.total_amount, b.created_at, b.contact_email, b.destination,
                            NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS customer_name
                        FROM booking_facts b LEFT JOIN user_facts u ON u.user_id = b.user_id
                        WHERE b.created_at >= :start AND b.created_at < :end
                        ORDER BY b.created_at DESC, b.booking_id DESC LIMIT 10""")
                .params(p).query((rs, i) -> new RecentBooking(rs.getString("id"), rs.getString("booking_reference"),
                        rs.getString("booking_type"), rs.getString("status"), rs.getString("title"),
                        money(rs.getBigDecimal("total_amount")), instant(rs, "created_at"),
                        rs.getString("customer_name"), rs.getString("contact_email"), rs.getString("destination")))
                .list();
    }

    /**
     * The activity feed: new customers, bookings (by how they stand), cancellations, captured and failed payments,
     * refunds and support tickets, newest first. Every source is limited to the range and to its newest few before the
     * merge, so the feed costs five small indexed queries.
     */
    private List<TimelineEvent> timeline(Map<String, Object> p) {
        List<TimelineEvent> events = new ArrayList<>();
        jdbc.sql("""
                        SELECT registered_at, BIN_TO_UUID(user_id) AS id, email,
                            NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '') AS name
                        FROM user_facts WHERE FIND_IN_SET('CUSTOMER', roles) > 0 AND registered_at >= :start
                            AND registered_at < :end ORDER BY registered_at DESC LIMIT 12""")
                .params(p).query((ResultSet rs) -> {
                    String name = rs.getString("name");
                    events.add(new TimelineEvent(instant(rs, "registered_at"), "CUSTOMER_REGISTERED", "SUCCESS",
                            "New customer registered", name != null ? name : rs.getString("email"), null, "USER",
                            rs.getString("id")));
                });
        jdbc.sql("""
                        SELECT created_at, BIN_TO_UUID(booking_id) AS id, booking_reference, booking_type, status, title,
                            total_amount, cancelled_at FROM booking_facts WHERE created_at >= :start AND created_at < :end
                        ORDER BY created_at DESC LIMIT 12""")
                .params(p).query((ResultSet rs) -> {
                    String status = rs.getString("status");
                    String outcome = rs.getTimestamp("cancelled_at") != null || List.of("CANCELLED", "REFUNDED",
                            "REFUND_PENDING", "CANCELLATION_PENDING").contains(status) ? "CANCELLED"
                            : List.of("FAILED", "EXPIRED").contains(status) ? "FAILED"
                            : List.of("CONFIRMED", "COMPLETED").contains(status) ? "SUCCESS" : "PENDING";
                    String type = "HOTEL".equals(rs.getString("booking_type")) ? "Hotel" : "Flight";
                    events.add(new TimelineEvent(instant(rs, "created_at"), "BOOKING_CREATED", outcome,
                            type + " booking", rs.getString("booking_reference") + " · " + rs.getString("title"),
                            money(rs.getBigDecimal("total_amount")), "BOOKING", rs.getString("id")));
                });
        jdbc.sql("""
                        SELECT c.cancelled_at, BIN_TO_UUID(c.booking_id) AS id, c.booking_reference, c.initiated_by,
                            c.refund_amount FROM cancellation_facts c WHERE c.cancelled_at >= :start
                            AND c.cancelled_at < :end ORDER BY c.cancelled_at DESC LIMIT 12""")
                .params(p).query((ResultSet rs) -> {
                    // A block, not an expression: a lambda that returns a value would be read as a ResultSetExtractor.
                    events.add(new TimelineEvent(instant(rs, "cancelled_at"), "BOOKING_CANCELLED", "CANCELLED",
                            "Booking cancelled", rs.getString("booking_reference") + " · by "
                                    + rs.getString("initiated_by").toLowerCase().replace('_', ' '),
                            money(rs.getBigDecimal("refund_amount")), "BOOKING", rs.getString("id")));
                });
        jdbc.sql("""
                        SELECT f.occurred_at, BIN_TO_UUID(f.payment_id) AS id, f.status, f.method,
                            COALESCE(f.amount, b.total_amount) AS amount, b.booking_reference
                        FROM payment_facts f LEFT JOIN booking_facts b ON b.booking_id = f.booking_id
                        WHERE f.occurred_at >= :start AND f.occurred_at < :end ORDER BY f.occurred_at DESC LIMIT 12""")
                .params(p).query((ResultSet rs) -> {
                    boolean ok = "SUCCESS".equals(rs.getString("status"));
                    String method = rs.getString("method");
                    String reference = rs.getString("booking_reference");
                    events.add(new TimelineEvent(instant(rs, "occurred_at"), ok ? "PAYMENT_SUCCEEDED" : "PAYMENT_FAILED",
                            ok ? "SUCCESS" : "FAILED", ok ? "Payment received" : "Payment failed",
                            (reference == null ? "" : reference) + (method == null ? "" : " · " + method),
                            money(rs.getBigDecimal("amount")), "PAYMENT", rs.getString("id")));
                });
        jdbc.sql("""
                        SELECT occurred_at, action, entity_type, entity_id FROM audit_logs
                        WHERE occurred_at >= :start AND occurred_at < :end AND (action LIKE 'TICKET%'
                            OR action LIKE 'BOOKING\\_REFUND%' OR action = 'BOOKING_GOODWILL_REFUND')
                        ORDER BY occurred_at DESC LIMIT 12""")
                .params(p).query((ResultSet rs) -> {
                    String action = rs.getString("action");
                    boolean ticket = action.startsWith("TICKET");
                    String outcome = "BOOKING_REFUND_COMPLETED".equals(action) ? "SUCCESS"
                            : "BOOKING_REFUND_FAILED".equals(action) ? "FAILED" : ticket ? "INFO" : "PENDING";
                    String words = action.toLowerCase().replace('_', ' ');
                    events.add(new TimelineEvent(instant(rs, "occurred_at"), ticket ? "SUPPORT_TICKET" : action,
                            outcome, Character.toUpperCase(words.charAt(0)) + words.substring(1), null, null,
                            rs.getString("entity_type"), rs.getString("entity_id")));
                });
        events.sort(java.util.Comparator.comparing(TimelineEvent::at).reversed());
        return events.size() > 12 ? new ArrayList<>(events.subList(0, 12)) : events;
    }

    private List<Activity> recentActivity(Map<String, Object> p) {
        return jdbc.sql("""
                        SELECT occurred_at, action, entity_type, entity_id, service, actor_roles FROM audit_logs
                        WHERE occurred_at >= :start AND occurred_at < :end ORDER BY occurred_at DESC, id DESC LIMIT 10""")
                .params(p).query((rs, i) -> {
                    String roles = rs.getString("actor_roles");
                    return new Activity(instant(rs, "occurred_at"), rs.getString("action"), rs.getString("entity_type"),
                            rs.getString("entity_id"), rs.getString("service"),
                            roles == null || roles.isBlank() ? "SYSTEM" : roles.split(",")[0]);
                }).list();
    }

    // ------------------------------------------------------------------ public (home page)

    /** Cities of paid bookings in the last days (90 by default), most booked first. */
    public List<PopularDestination> popularDestinations(int limit) {
        return jdbc.sql("""
                        SELECT destination, COUNT(*) AS bookings FROM booking_facts
                        WHERE confirmed_at IS NOT NULL AND destination IS NOT NULL AND created_at >= :since
                        GROUP BY destination ORDER BY bookings DESC, destination LIMIT :limit""")
                .param("since", since()).param("limit", Math.clamp(limit, 1, 20))
                .query((rs, i) -> new PopularDestination(rs.getString("destination"), rs.getLong("bookings"))).list();
    }

    /** Routes (first flight of the trip) of paid flight bookings in the last days, most booked first. */
    public List<PopularRoute> popularRoutes(int limit) {
        return jdbc.sql("""
                        SELECT route_origin, route_destination, MAX(origin_city) AS origin_city,
                            MAX(destination) AS destination_city, COUNT(*) AS bookings
                        FROM booking_facts
                        WHERE booking_type = 'FLIGHT' AND confirmed_at IS NOT NULL AND route_origin IS NOT NULL
                            AND route_destination IS NOT NULL AND created_at >= :since
                        GROUP BY route_origin, route_destination
                        ORDER BY bookings DESC, route_origin, route_destination LIMIT :limit""")
                .param("since", since()).param("limit", Math.clamp(limit, 1, 20))
                .query((rs, i) -> new PopularRoute(rs.getString("route_origin"), rs.getString("route_destination"),
                        rs.getString("origin_city"), rs.getString("destination_city"), rs.getLong("bookings")))
                .list();
    }

    private LocalDateTime since() {
        return LocalDateTime.ofInstant(clock.instant().minus(java.time.Duration.ofDays(publicDays)), ZoneOffset.UTC);
    }

    // ------------------------------------------------------------------ helpers

    static long n(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value == null ? 0 : ((Number) value).longValue();
    }

    static BigDecimal money(Object value) {
        BigDecimal amount = value == null ? BigDecimal.ZERO : value instanceof BigDecimal decimal ? decimal
                : new BigDecimal(value.toString());
        return amount.setScale(2, java.math.RoundingMode.HALF_UP);
    }

    static Instant instant(ResultSet rs, String column) throws SQLException {
        LocalDateTime value = rs.getObject(column, LocalDateTime.class);
        return value == null ? null : value.toInstant(ZoneOffset.UTC);
    }
}
