package com.flighthotel.reporting.report;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import org.springframework.http.HttpStatus;

import com.flighthotel.common.analytics.DayRange;
import com.flighthotel.common.error.ApiException;

/**
 * The date range of a dashboard or report (API_DOCUMENTATION.md section 14.0): India days, both ends inclusive, at most
 * 366 days (reports) or five years (the admin dashboard, Phase 11). The database keeps UTC, so {@link #startUtc()} and
 * {@link #endUtc()} (exclusive) are the boundaries to query with.
 */
public record ReportRange(String preset, LocalDate from, LocalDate to) {

    public static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    static final int MAX_DAYS = 366;

    public static ReportRange of(String preset, LocalDate from, LocalDate to, Clock clock) {
        return of(preset, from, to, clock, MAX_DAYS);
    }

    /**
     * Also the Phase 11 presets of {@link DayRange} ({@code LAST_90_DAYS}, {@code THIS_YEAR}, {@code PREVIOUS_YEAR},
     * {@code LAST_12_MONTHS}, {@code LAST_3_YEARS}, {@code LAST_5_YEARS}), as long as the range has at most
     * {@code maxDays} days.
     */
    public static ReportRange of(String preset, LocalDate from, LocalDate to, Clock clock, int maxDays) {
        LocalDate today = LocalDate.now(clock.withZone(INDIA));
        String name = preset == null || preset.isBlank() ? "LAST_30_DAYS" : preset.strip().toUpperCase(Locale.ROOT);
        ReportRange range = "CUSTOM".equals(name) ? custom(from, to)
                : DayRange.preset(name, today).map(r -> new ReportRange(name, r.from(), r.to()))
                        .orElseThrow(() -> invalid("Unknown range " + name + "."));
        if (ChronoUnit.DAYS.between(range.from(), range.to()) + 1 > maxDays) {
            throw invalid("A range covers at most " + maxDays + " days.");
        }
        return range;
    }

    private static ReportRange custom(LocalDate from, LocalDate to) {
        if (from == null || to == null) {
            throw invalid("A custom range needs 'from' and 'to' (YYYY-MM-DD).");
        }
        if (to.isBefore(from)) {
            throw invalid("'to' must not be before 'from'.");
        }
        return new ReportRange("CUSTOM", from, to);
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_RANGE", message);
    }

    /** Start of the first day, as a UTC wall time for DATETIME columns. */
    public LocalDateTime startUtc() {
        return LocalDateTime.ofInstant(from.atStartOfDay(INDIA).toInstant(), ZoneOffset.UTC);
    }

    /** Start of the day after the last one (exclusive). */
    public LocalDateTime endUtc() {
        return LocalDateTime.ofInstant(to.plusDays(1).atStartOfDay(INDIA).toInstant(), ZoneOffset.UTC);
    }

    public List<LocalDate> days() {
        List<LocalDate> days = new ArrayList<>();
        for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
            days.add(day);
        }
        return days;
    }

    public DayRange toDayRange() {
        return new DayRange(preset, from, to);
    }

    /** The same number of days right before this range (Phase 11 comparisons). */
    public ReportRange previous() {
        DayRange previous = toDayRange().previous();
        return new ReportRange(previous.preset(), previous.from(), previous.to());
    }

    /** For file names: "2026-10-07-2026-11-05". */
    public String label() {
        return from + "-" + to;
    }
}
