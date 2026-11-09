package com.flighthotel.common.analytics;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.time.temporal.IsoFields;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.http.HttpStatus;

import com.flighthotel.common.error.ApiException;

/**
 * The step of a trend series. A range is cut at calendar boundaries: weeks start on Monday (ISO weeks), months on the
 * 1st, years on 1 January. The first and last bucket are cut to the range, so they may be shorter.
 * <p>
 * Keys: DAY {@code 2026-11-06}, WEEK {@code 2026-W45} (ISO week-based year), MONTH {@code 2026-11}, YEAR {@code 2026}.
 */
public enum Interval {
    DAY(366), WEEK(262), MONTH(120), YEAR(20);

    private final int maxBuckets;

    Interval(int maxBuckets) {
        this.maxBuckets = maxBuckets;
    }

    /** The most buckets a series of this interval may have (DAY 366, WEEK 262, MONTH 120, YEAR 20). */
    public int maxBuckets() {
        return maxBuckets;
    }

    /**
     * The interval a request asks for: none means {@link #auto}; an unknown one, or one that would cut the range into
     * more than {@link #maxBuckets()} buckets, is {@code 400 INVALID_INTERVAL}.
     */
    public static Interval resolve(String value, DayRange range) {
        if (value == null || value.isBlank()) {
            return auto(range);
        }
        Interval interval;
        try {
            interval = valueOf(value.strip().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException unknown) {
            throw invalid("Unknown interval " + value.strip() + ". Use DAY, WEEK, MONTH or YEAR.");
        }
        long buckets = interval.count(range);
        if (buckets > interval.maxBuckets) {
            String series = switch (interval) {
                case DAY -> "daily";
                case WEEK -> "weekly";
                case MONTH -> "monthly";
                case YEAR -> "yearly";
            };
            throw invalid("A " + series + " series has at most " + interval.maxBuckets + " points; this range has "
                    + buckets + ". Choose a longer interval.");
        }
        return interval;
    }

    /** By the length of the range: up to 31 days DAY, up to 92 WEEK, up to 731 MONTH, longer YEAR. */
    public static Interval auto(DayRange range) {
        long days = range.length();
        if (days <= 31) {
            return DAY;
        }
        if (days <= 92) {
            return WEEK;
        }
        return days <= 731 ? MONTH : YEAR;
    }

    /** The first day of the calendar bucket the day is in (not cut to any range). */
    public LocalDate startOf(LocalDate day) {
        return switch (this) {
            case DAY -> day;
            case WEEK -> day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            case MONTH -> day.withDayOfMonth(1);
            case YEAR -> day.withDayOfYear(1);
        };
    }

    private LocalDate nextStart(LocalDate start) {
        return switch (this) {
            case DAY -> start.plusDays(1);
            case WEEK -> start.plusWeeks(1);
            case MONTH -> start.plusMonths(1);
            case YEAR -> start.plusYears(1);
        };
    }

    /** The key of the bucket the day is in. */
    public String key(LocalDate day) {
        LocalDate start = startOf(day);
        return switch (this) {
            case DAY -> start.toString();
            case WEEK -> String.format(Locale.ROOT, "%d-W%02d", start.get(IsoFields.WEEK_BASED_YEAR),
                    start.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR));
            case MONTH -> String.format(Locale.ROOT, "%04d-%02d", start.getYear(), start.getMonthValue());
            case YEAR -> String.format(Locale.ROOT, "%04d", start.getYear());
        };
    }

    /** The buckets of the range, in order, the first and last cut to the range. */
    public List<Bucket> buckets(DayRange range) {
        List<Bucket> buckets = new ArrayList<>();
        for (LocalDate start = startOf(range.from()); !start.isAfter(range.to()); start = nextStart(start)) {
            LocalDate from = start.isBefore(range.from()) ? range.from() : start;
            LocalDate end = nextStart(start).minusDays(1);
            buckets.add(new Bucket(key(start), from, end.isAfter(range.to()) ? range.to() : end));
        }
        return buckets;
    }

    /** The number of buckets of the range. */
    public long count(DayRange range) {
        LocalDate first = startOf(range.from());
        LocalDate last = startOf(range.to());
        return switch (this) {
            case DAY -> range.length();
            case WEEK -> ChronoUnit.WEEKS.between(first, last) + 1;
            case MONTH -> ChronoUnit.MONTHS.between(first, last) + 1;
            case YEAR -> ChronoUnit.YEARS.between(first, last) + 1;
        };
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_INTERVAL", message, Map.of());
    }

    /** One point of a series: its key and its first and last day (both inclusive). */
    public record Bucket(String key, LocalDate start, LocalDate end) {

        public boolean contains(LocalDate day) {
            return !day.isBefore(start) && !day.isAfter(end);
        }
    }
}
