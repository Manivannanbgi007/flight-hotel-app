package com.flighthotel.reporting.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.flighthotel.common.error.ApiException;

/**
 * Report ranges (API_DOCUMENTATION.md section 14.0): presets on India days, both ends included, at most 366 days,
 * and the UTC boundaries the database is queried with.
 */
class ReportRangeTest {

    /** 2026-11-05 12:00 in India. */
    private static final Clock NOV_5 = clock("2026-11-05T06:30:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 5);

    @Test
    void todayIsTheIndiaDayNotTheUtcDay() {
        // 23:59:59 in India is still the 5th; one second later it is the 6th, while UTC is still on the 5th.
        assertThat(ReportRange.of("TODAY", null, null, clock("2026-11-05T18:29:59Z")).from()).isEqualTo(TODAY);
        assertThat(ReportRange.of("TODAY", null, null, clock("2026-11-05T18:30:00Z")).from())
                .isEqualTo(TODAY.plusDays(1));
    }

    @Test
    void presetsEndTodayAndIncludeBothEnds() {
        assertThat(ReportRange.of(null, null, null, NOV_5))
                .isEqualTo(new ReportRange("LAST_30_DAYS", LocalDate.of(2026, 10, 7), TODAY));
        assertThat(ReportRange.of(" ", null, null, NOV_5).preset()).isEqualTo("LAST_30_DAYS");
        assertThat(ReportRange.of(" last_7_days ", null, null, NOV_5))
                .isEqualTo(new ReportRange("LAST_7_DAYS", LocalDate.of(2026, 10, 30), TODAY));
        assertThat(ReportRange.of("LAST_14_DAYS", null, null, NOV_5).days()).hasSize(14).endsWith(TODAY);
        assertThat(ReportRange.of("LAST_30_DAYS", null, null, NOV_5).days()).hasSize(30);
        assertThat(ReportRange.of("THIS_MONTH", null, null, NOV_5))
                .isEqualTo(new ReportRange("THIS_MONTH", LocalDate.of(2026, 11, 1), TODAY));
        // from/to are ignored unless the range is CUSTOM.
        assertThat(ReportRange.of("TODAY", LocalDate.of(2020, 1, 1), LocalDate.of(2020, 2, 1), NOV_5))
                .isEqualTo(new ReportRange("TODAY", TODAY, TODAY));
    }

    @Test
    void thePreviousMonthIsAWholeCalendarMonth() {
        assertThat(ReportRange.of("PREVIOUS_MONTH", null, null, NOV_5))
                .isEqualTo(new ReportRange("PREVIOUS_MONTH", LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31)));
        // Leap year February, and January looks back into last year.
        assertThat(ReportRange.of("PREVIOUS_MONTH", null, null, clock("2028-03-31T06:30:00Z")).to())
                .isEqualTo(LocalDate.of(2028, 2, 29));
        assertThat(ReportRange.of("PREVIOUS_MONTH", null, null, clock("2027-01-15T06:30:00Z")))
                .isEqualTo(new ReportRange("PREVIOUS_MONTH", LocalDate.of(2026, 12, 1), LocalDate.of(2026, 12, 31)));
    }

    @Test
    void aCustomRangeCoversAtMost366Days() {
        // A whole leap year is 366 days and allowed; one more day is not.
        ReportRange leapYear = ReportRange.of("custom", LocalDate.of(2028, 1, 1), LocalDate.of(2028, 12, 31), NOV_5);
        assertThat(leapYear.days()).hasSize(366);
        assertThat(ReportRange.of("CUSTOM", TODAY, TODAY, NOV_5).days()).containsExactly(TODAY);

        assertInvalid("CUSTOM", LocalDate.of(2027, 12, 31), LocalDate.of(2028, 12, 31), "at most 366 days");
        assertInvalid("CUSTOM", TODAY, TODAY.minusDays(1), "'to' must not be before 'from'");
        assertInvalid("CUSTOM", TODAY, null, "needs 'from' and 'to'");
        assertInvalid("CUSTOM", null, TODAY, "needs 'from' and 'to'");
        assertInvalid("YESTERDAY", null, null, "Unknown range YESTERDAY");
    }

    @Test
    void theDatabaseIsQueriedWithUtcBoundariesOfTheIndiaDays() {
        ReportRange day = new ReportRange("CUSTOM", TODAY, TODAY);
        // 00:00 in India is 18:30 UTC the day before; the end is the start of the next India day (exclusive).
        assertThat(day.startUtc()).isEqualTo(LocalDateTime.of(2026, 11, 4, 18, 30));
        assertThat(day.endUtc()).isEqualTo(LocalDateTime.of(2026, 11, 5, 18, 30));

        ReportRange march = new ReportRange("CUSTOM", LocalDate.of(2026, 3, 1), LocalDate.of(2026, 3, 31));
        assertThat(march.startUtc()).isEqualTo(LocalDateTime.of(2026, 2, 28, 18, 30));
        assertThat(march.endUtc()).isEqualTo(LocalDateTime.of(2026, 3, 31, 18, 30));
        assertThat(march.label()).isEqualTo("2026-03-01-2026-03-31");
    }

    private static void assertInvalid(String preset, LocalDate from, LocalDate to, String messagePart) {
        assertThatThrownBy(() -> ReportRange.of(preset, from, to, NOV_5))
                .isInstanceOfSatisfying(ApiException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(ex.getCode()).isEqualTo("INVALID_RANGE");
                    assertThat(ex.getMessage()).contains(messagePart);
                });
    }

    private static Clock clock(String instant) {
        return Clock.fixed(Instant.parse(instant), ZoneOffset.UTC);
    }
}
