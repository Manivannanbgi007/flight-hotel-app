package com.flighthotel.hotel.report;

import static java.time.temporal.ChronoUnit.DAYS;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Locale;
import java.util.Map;

import org.springframework.http.HttpStatus;

import com.flighthotel.common.analytics.DayRange;
import com.flighthotel.common.error.ApiException;
import com.flighthotel.hotel.dto.ReportDtos.DateRange;

/**
 * The date ranges of dashboards and reports (API_DOCUMENTATION.md §14.0), in India days (Asia/Kolkata), both days
 * inclusive. {@code LAST_7_DAYS} = today and the 6 days before; {@code THIS_MONTH} = the 1st until today;
 * {@code PREVIOUS_MONTH} = the whole previous month; {@code CUSTOM} needs {@code from} and {@code to}, at most
 * {@value #MAX_DAYS} days (the dashboard: five years). Phase 11 adds the presets of {@link DayRange}. Anything else:
 * {@code 400 INVALID_RANGE}.
 */
public final class ReportRanges {

    public static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    public static final String DEFAULT = "LAST_30_DAYS";
    static final int MAX_DAYS = 366;

    private ReportRanges() {
    }

    public static DateRange resolve(String preset, LocalDate from, LocalDate to, LocalDate today) {
        return resolve(preset, from, to, today, MAX_DAYS);
    }

    /**
     * Also the Phase 11 presets of {@link DayRange} ({@code LAST_90_DAYS}, {@code THIS_YEAR}, {@code PREVIOUS_YEAR},
     * {@code LAST_12_MONTHS}, {@code LAST_3_YEARS}, {@code LAST_5_YEARS}), as long as the range has at most
     * {@code maxDays} days (reports: 366; the dashboard: five years).
     */
    public static DateRange resolve(String preset, LocalDate from, LocalDate to, LocalDate today, int maxDays) {
        String name = preset == null || preset.isBlank() ? DEFAULT : preset.strip().toUpperCase(Locale.ROOT);
        DateRange range = "CUSTOM".equals(name) ? custom(from, to)
                : DayRange.preset(name, today).map(r -> new DateRange(name, r.from(), r.to()))
                        .orElseThrow(() -> invalid("Unknown range " + preset + ". Use TODAY, LAST_7_DAYS, LAST_14_DAYS, "
                                + "LAST_30_DAYS, LAST_90_DAYS, THIS_MONTH, PREVIOUS_MONTH, THIS_YEAR, PREVIOUS_YEAR, "
                                + "LAST_12_MONTHS, LAST_3_YEARS, LAST_5_YEARS or CUSTOM."));
        if (DAYS.between(range.from(), range.to()) + 1 > maxDays) {
            throw invalid("A range can cover at most " + maxDays + " days.");
        }
        return range;
    }

    public static DayRange toDayRange(DateRange range) {
        return new DayRange(range.preset(), range.from(), range.to());
    }

    private static DateRange custom(LocalDate from, LocalDate to) {
        if (from == null || to == null) {
            throw invalid("A custom range needs both from and to.");
        }
        if (to.isBefore(from)) {
            throw invalid("The end date must not be before the start date.");
        }
        return new DateRange("CUSTOM", from, to);
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_RANGE", message, Map.of());
    }
}
