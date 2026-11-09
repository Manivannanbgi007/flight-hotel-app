package com.flighthotel.common.analytics;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

import org.springframework.http.HttpStatus;

import com.flighthotel.common.error.ApiException;

/**
 * A range of whole days, both ends inclusive, for dashboards (API_DOCUMENTATION.md §14.0 and Phase 11). Days are
 * India days (Asia/Kolkata) unless the caller passes another "today".
 * <p>
 * Presets, relative to today:
 * <ul>
 * <li>{@code TODAY}; {@code LAST_7_DAYS}, {@code LAST_14_DAYS}, {@code LAST_30_DAYS}, {@code LAST_90_DAYS}: today and
 * the days before it;</li>
 * <li>{@code THIS_MONTH} (the 1st until today), {@code PREVIOUS_MONTH} (the whole calendar month);</li>
 * <li>{@code THIS_YEAR} (1 January until today), {@code PREVIOUS_YEAR} (the whole calendar year);</li>
 * <li>{@code LAST_12_MONTHS}: the 1st of the month eleven months ago until today, so a monthly chart has twelve whole
 * calendar months (the last one until today);</li>
 * <li>{@code LAST_3_YEARS}, {@code LAST_5_YEARS}: 1 January two / four years ago until today (three / five calendar
 * years, the last one until today).</li>
 * </ul>
 * {@code CUSTOM} needs {@code from} and {@code to}. Each endpoint sets the longest range it accepts; a longer one (also
 * a preset) is {@code 400 INVALID_RANGE}.
 */
public record DayRange(String preset, LocalDate from, LocalDate to) {

    public static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    public static final String CUSTOM = "CUSTOM";
    public static final String PREVIOUS_PERIOD = "PREVIOUS_PERIOD";
    /** A whole leap year. */
    public static final int ONE_YEAR = 366;
    /** Five calendar years hold at most two leap days. */
    public static final int FIVE_YEARS = 5 * 365 + 2;

    public static final List<String> PRESETS = List.of("TODAY", "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS",
            "LAST_90_DAYS", "THIS_MONTH", "PREVIOUS_MONTH", "THIS_YEAR", "PREVIOUS_YEAR", "LAST_12_MONTHS",
            "LAST_3_YEARS", "LAST_5_YEARS");

    public DayRange {
        if (from == null || to == null || to.isBefore(from)) {
            throw new IllegalArgumentException("A range needs from <= to");
        }
    }

    /** The named preset for this day, or empty for CUSTOM and unknown names. {@code name} must be upper case. */
    public static Optional<DayRange> preset(String name, LocalDate today) {
        DayRange range = switch (name) {
            case "TODAY" -> new DayRange(name, today, today);
            case "LAST_7_DAYS" -> new DayRange(name, today.minusDays(6), today);
            case "LAST_14_DAYS" -> new DayRange(name, today.minusDays(13), today);
            case "LAST_30_DAYS" -> new DayRange(name, today.minusDays(29), today);
            case "LAST_90_DAYS" -> new DayRange(name, today.minusDays(89), today);
            case "THIS_MONTH" -> new DayRange(name, today.withDayOfMonth(1), today);
            case "PREVIOUS_MONTH" -> {
                YearMonth previous = YearMonth.from(today).minusMonths(1);
                yield new DayRange(name, previous.atDay(1), previous.atEndOfMonth());
            }
            case "THIS_YEAR" -> new DayRange(name, today.withDayOfYear(1), today);
            case "PREVIOUS_YEAR" -> {
                LocalDate first = today.withDayOfYear(1).minusYears(1);
                yield new DayRange(name, first, first.withDayOfYear(first.lengthOfYear()));
            }
            case "LAST_12_MONTHS" -> new DayRange(name, today.withDayOfMonth(1).minusMonths(11), today);
            case "LAST_3_YEARS" -> new DayRange(name, today.withDayOfYear(1).minusYears(2), today);
            case "LAST_5_YEARS" -> new DayRange(name, today.withDayOfYear(1).minusYears(4), today);
            default -> null;
        };
        return Optional.ofNullable(range);
    }

    /**
     * The range a request asks for.
     *
     * @param preset        a preset or CUSTOM, any case; null or blank means {@code defaultPreset}
     * @param maxDays       the longest range this endpoint accepts
     * @throws ApiException 400 INVALID_RANGE
     */
    public static DayRange resolve(String preset, LocalDate from, LocalDate to, LocalDate today, String defaultPreset,
            int maxDays) {
        String name = preset == null || preset.isBlank() ? defaultPreset : preset.strip().toUpperCase(Locale.ROOT);
        DayRange range;
        if (CUSTOM.equals(name)) {
            if (from == null || to == null) {
                throw invalid("A custom range needs 'from' and 'to' (YYYY-MM-DD).");
            }
            if (to.isBefore(from)) {
                throw invalid("'to' must not be before 'from'.");
            }
            range = new DayRange(CUSTOM, from, to);
        } else {
            range = preset(name, today).orElseThrow(() -> invalid("Unknown range " + name + ". Use "
                    + String.join(", ", PRESETS) + " or CUSTOM."));
        }
        if (range.length() > maxDays) {
            throw invalid("A range covers at most " + maxDays + " days here.");
        }
        return range;
    }

    public static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_RANGE", message, Map.of());
    }

    /** Number of days, both ends included. */
    public long length() {
        return ChronoUnit.DAYS.between(from, to) + 1;
    }

    /** The same number of days right before this range ({@code PREVIOUS_PERIOD}). */
    public DayRange previous() {
        return new DayRange(PREVIOUS_PERIOD, from.minusDays(length()), from.minusDays(1));
    }

    public boolean contains(LocalDate day) {
        return day != null && !day.isBefore(from) && !day.isAfter(to);
    }

    /** Start of the first day in {@code zone}, as the UTC wall time stored in DATETIME columns. */
    public LocalDateTime startUtc(ZoneId zone) {
        return LocalDateTime.ofInstant(from.atStartOfDay(zone).toInstant(), ZoneOffset.UTC);
    }

    /** Start of the day after the last one in {@code zone} (exclusive), as a UTC wall time. */
    public LocalDateTime endUtc(ZoneId zone) {
        return LocalDateTime.ofInstant(to.plusDays(1).atStartOfDay(zone).toInstant(), ZoneOffset.UTC);
    }

    public List<LocalDate> eachDay() {
        List<LocalDate> days = new ArrayList<>();
        for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
            days.add(day);
        }
        return days;
    }
}
