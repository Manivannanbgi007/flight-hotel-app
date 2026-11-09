package com.flighthotel.notification.ticket;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.analytics.Change;
import com.flighthotel.common.analytics.DayRange;
import com.flighthotel.common.analytics.Interval;
import com.flighthotel.common.analytics.Interval.Bucket;
import com.flighthotel.common.analytics.Timeline;
import com.flighthotel.notification.ticket.SupportTicket.Category;
import com.flighthotel.notification.ticket.SupportTicket.Status;

/**
 * The support dashboard's figures (Phase 11 §11.3), from the tickets and their messages:
 * <ul>
 * <li>{@code byStatus}, {@code open} and {@code age}: all tickets as they are now; the age of an open ticket (not
 * resolved or closed) is the time since it was opened;</li>
 * <li>for the range (India days): tickets {@code opened} (created) and {@code resolved} (resolved or closed, and not
 * reopened since), per interval in {@code series};</li>
 * <li>{@code firstResponse}: of the tickets opened in the range, the time until the first answer of an agent or admin
 * (minutes; tickets without an answer yet are counted as awaiting while they are open);</li>
 * <li>{@code resolution}: of the tickets resolved in the range, the time from opening to resolving (hours);</li>
 * <li>{@code comparison}: against the previous period of the same length.</li>
 * </ul>
 */
@Service
public class SupportMetricsService {

    static final String DEFAULT_RANGE = "LAST_30_DAYS";
    static final String STAFF_REPLY = "m.author_role IN ('SUPPORT_AGENT', 'ADMIN')";

    private final JdbcClient jdbc;
    private final Clock clock;

    public SupportMetricsService(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public record Range(String preset, LocalDate from, LocalDate to) {
    }

    /** Open tickets by age: {@code UNDER_1_DAY}, {@code 1_TO_3_DAYS}, {@code 3_TO_7_DAYS}, {@code OVER_7_DAYS}. */
    public record AgeBucket(String key, String label, long count) {
    }

    /**
     * @param averageHours  of the open tickets (one decimal; null without any)
     * @param oldestOpenedAt the oldest open ticket (null without any)
     */
    public record Age(List<AgeBucket> buckets, BigDecimal averageHours, Instant oldestOpenedAt) {
    }

    /**
     * @param averageMinutes  average time to the first agent answer (one decimal; null without any answer)
     * @param medianMinutes   median of the same (one decimal; null without any answer)
     * @param responded       tickets opened in the range that got an answer
     * @param awaiting        tickets opened in the range without an answer that are still open
     */
    public record FirstResponse(BigDecimal averageMinutes, BigDecimal medianMinutes, long responded, long awaiting) {
    }

    /** @param averageHours time from opening to resolving of the tickets resolved in the range (one decimal) */
    public record Resolution(long resolved, BigDecimal averageHours) {
    }

    public record SeriesPoint(String key, LocalDate start, LocalDate end, long opened, long resolved) {
    }

    /** {@code averageFirstResponseMinutes} is null when either period has no answered ticket. */
    public record Comparison(Change opened, Change resolved, Change averageFirstResponseMinutes) {
    }

    public record SupportMetrics(Range range, Interval interval, Range previousRange, Map<String, Long> byStatus,
            long open, Age age, long opened, long resolved, Map<String, Long> openedByCategory,
            FirstResponse firstResponse, Resolution resolution, List<SeriesPoint> series, Comparison comparison,
            Instant generatedAt) {
    }

    /** One ticket opened in [previous.from, range.to]: when, and when it was first answered. */
    private record Opened(LocalDate day, Instant createdAt, Instant firstReply, boolean resolved, String category) {
    }

    @PreAuthorize("hasAuthority('SUPPORT_TICKET_MANAGE')")
    @Transactional(readOnly = true)
    public SupportMetrics metrics(String preset, LocalDate from, LocalDate to, String interval) {
        Instant now = clock.instant();
        DayRange range = DayRange.resolve(preset, from, to, LocalDate.now(clock.withZone(DayRange.INDIA)),
                DEFAULT_RANGE, DayRange.FIVE_YEARS);
        Interval step = Interval.resolve(interval, range);
        DayRange previous = range.previous();

        Map<String, Long> byStatus = new LinkedHashMap<>();
        for (Status status : Status.values()) {
            byStatus.put(status.name(), 0L);
        }
        jdbc.sql("SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status")
                .query((ResultSet rs) -> {
                    byStatus.merge(rs.getString("status"), rs.getLong("n"), Long::sum);
                });
        long open = byStatus.entrySet().stream()
                .filter(e -> !e.getKey().equals(Status.RESOLVED.name()) && !e.getKey().equals(Status.CLOSED.name()))
                .mapToLong(Map.Entry::getValue).sum();

        List<Opened> opened = jdbc.sql("SELECT t.created_at, t.status, t.category, (SELECT MIN(m.created_at) "
                        + "FROM support_ticket_messages m WHERE m.ticket_id = t.id AND " + STAFF_REPLY
                        + " AND m.created_at >= t.created_at) AS first_reply FROM support_tickets t "
                        + "WHERE t.created_at >= :start AND t.created_at < :end")
                .param("start", previous.startUtc(DayRange.INDIA))
                .param("end", range.endUtc(DayRange.INDIA))
                .query((rs, i) -> {
                    Instant created = instant(rs.getObject("created_at", LocalDateTime.class));
                    String status = rs.getString("status");
                    return new Opened(day(created), created, instant(rs.getObject("first_reply", LocalDateTime.class)),
                            Status.RESOLVED.name().equals(status) || Status.CLOSED.name().equals(status),
                            rs.getString("category"));
                })
                .list();
        List<Instant[]> resolved = jdbc.sql("SELECT created_at, resolved_at FROM support_tickets "
                        + "WHERE resolved_at >= :start AND resolved_at < :end")
                .param("start", previous.startUtc(DayRange.INDIA))
                .param("end", range.endUtc(DayRange.INDIA))
                .query((rs, i) -> new Instant[] {instant(rs.getObject("created_at", LocalDateTime.class)),
                        instant(rs.getObject("resolved_at", LocalDateTime.class))})
                .list();

        List<Opened> openedNow = opened.stream().filter(t -> range.contains(t.day())).toList();
        List<Instant[]> resolvedNow = resolved.stream().filter(t -> range.contains(day(t[1]))).toList();
        FirstResponse firstResponse = firstResponse(openedNow);
        FirstResponse firstResponseBefore = firstResponse(opened.stream()
                .filter(t -> previous.contains(t.day())).toList());
        long resolvedBefore = resolved.stream().filter(t -> previous.contains(day(t[1]))).count();

        Map<String, Long> byCategory = new LinkedHashMap<>();
        for (Category category : Category.values()) {
            byCategory.put(category.name(), 0L);
        }
        openedNow.forEach(t -> byCategory.merge(t.category(), 1L, Long::sum));

        return new SupportMetrics(new Range(range.preset(), range.from(), range.to()), step,
                new Range(previous.preset(), previous.from(), previous.to()), byStatus, open, age(now),
                openedNow.size(), resolvedNow.size(), byCategory, firstResponse,
                new Resolution(resolvedNow.size(), averageHours(resolvedNow.stream()
                        .map(t -> Duration.between(t[0], t[1])).toList())),
                series(Timeline.of(range, step), openedNow, resolvedNow),
                new Comparison(Change.of(openedNow.size(), opened.size() - openedNow.size()),
                        Change.of(resolvedNow.size(), resolvedBefore),
                        firstResponse.averageMinutes() == null || firstResponseBefore.averageMinutes() == null ? null
                                : Change.of(firstResponse.averageMinutes(), firstResponseBefore.averageMinutes())),
                now);
    }

    private Age age(Instant now) {
        List<Instant> openSince = jdbc.sql("SELECT created_at FROM support_tickets "
                        + "WHERE status NOT IN ('RESOLVED', 'CLOSED') ORDER BY created_at")
                .query((rs, i) -> instant(rs.getObject("created_at", LocalDateTime.class)))
                .list();
        long[] counts = new long[4];
        List<Duration> ages = new ArrayList<>();
        for (Instant created : openSince) {
            Duration age = Duration.between(created, now);
            ages.add(age);
            long hours = age.toHours();
            counts[hours < 24 ? 0 : hours < 72 ? 1 : hours < 168 ? 2 : 3]++;
        }
        return new Age(List.of(new AgeBucket("UNDER_1_DAY", "Under 1 day", counts[0]),
                new AgeBucket("1_TO_3_DAYS", "1–3 days", counts[1]),
                new AgeBucket("3_TO_7_DAYS", "3–7 days", counts[2]),
                new AgeBucket("OVER_7_DAYS", "7 days or more", counts[3])),
                averageHours(ages), openSince.isEmpty() ? null : openSince.getFirst());
    }

    private static FirstResponse firstResponse(List<Opened> tickets) {
        List<Long> seconds = tickets.stream().filter(t -> t.firstReply() != null)
                .map(t -> Duration.between(t.createdAt(), t.firstReply()).toSeconds()).sorted().toList();
        long awaiting = tickets.stream().filter(t -> t.firstReply() == null && !t.resolved()).count();
        if (seconds.isEmpty()) {
            return new FirstResponse(null, null, 0, awaiting);
        }
        BigDecimal sixty = BigDecimal.valueOf(60);
        BigDecimal average = BigDecimal.valueOf(seconds.stream().mapToLong(Long::longValue).sum())
                .divide(BigDecimal.valueOf(seconds.size()).multiply(sixty), 1, RoundingMode.HALF_UP);
        int middle = seconds.size() / 2;
        BigDecimal median = seconds.size() % 2 == 1 ? BigDecimal.valueOf(seconds.get(middle))
                : BigDecimal.valueOf(seconds.get(middle - 1) + seconds.get(middle)).divide(BigDecimal.TWO);
        return new FirstResponse(average, median.divide(sixty, 1, RoundingMode.HALF_UP), seconds.size(), awaiting);
    }

    private static List<SeriesPoint> series(Timeline timeline, List<Opened> opened, List<Instant[]> resolved) {
        long[][] counts = new long[timeline.size()][2];
        opened.forEach(t -> counts[timeline.indexOf(t.day())][0]++);
        resolved.forEach(t -> counts[timeline.indexOf(day(t[1]))][1]++);
        List<SeriesPoint> points = new ArrayList<>();
        for (int i = 0; i < timeline.size(); i++) {
            Bucket bucket = timeline.buckets().get(i);
            points.add(new SeriesPoint(bucket.key(), bucket.start(), bucket.end(), counts[i][0], counts[i][1]));
        }
        return points;
    }

    private static BigDecimal averageHours(List<Duration> durations) {
        if (durations.isEmpty()) {
            return null;
        }
        long seconds = durations.stream().mapToLong(Duration::toSeconds).sum();
        return BigDecimal.valueOf(seconds).divide(BigDecimal.valueOf(durations.size() * 3600L), 1,
                RoundingMode.HALF_UP);
    }

    private static Instant instant(LocalDateTime utc) {
        return utc == null ? null : utc.toInstant(ZoneOffset.UTC);
    }

    private static LocalDate day(Instant instant) {
        return instant.atZone(DayRange.INDIA).toLocalDate();
    }
}
