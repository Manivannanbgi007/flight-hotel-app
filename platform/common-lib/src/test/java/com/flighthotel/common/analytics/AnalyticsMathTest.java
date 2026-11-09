package com.flighthotel.common.analytics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.flighthotel.common.analytics.Change.Trend;
import com.flighthotel.common.analytics.Interval.Bucket;
import com.flighthotel.common.error.ApiException;

/** Phase 11 dashboard maths: ranges, the previous period, interval buckets and growth. */
class AnalyticsMathTest {

    /** A Friday. */
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 6);

    // ------------------------------------------------------------------ ranges

    @Test
    void presetsEndTodayAndIncludeBothEnds() {
        assertThat(range("TODAY")).isEqualTo(new DayRange("TODAY", TODAY, TODAY));
        assertThat(range("LAST_7_DAYS").from()).isEqualTo(LocalDate.of(2026, 10, 31));
        assertThat(range("LAST_30_DAYS").length()).isEqualTo(30);
        assertThat(range("LAST_90_DAYS").length()).isEqualTo(90);
        assertThat(range("THIS_MONTH")).isEqualTo(new DayRange("THIS_MONTH", LocalDate.of(2026, 11, 1), TODAY));
        assertThat(range("PREVIOUS_MONTH"))
                .isEqualTo(new DayRange("PREVIOUS_MONTH", LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31)));
        assertThat(range("THIS_YEAR")).isEqualTo(new DayRange("THIS_YEAR", LocalDate.of(2026, 1, 1), TODAY));
        assertThat(range("PREVIOUS_YEAR"))
                .isEqualTo(new DayRange("PREVIOUS_YEAR", LocalDate.of(2025, 1, 1), LocalDate.of(2025, 12, 31)));
        // Twelve calendar months, the current one until today.
        assertThat(range("LAST_12_MONTHS"))
                .isEqualTo(new DayRange("LAST_12_MONTHS", LocalDate.of(2025, 12, 1), TODAY));
        assertThat(range("LAST_3_YEARS").from()).isEqualTo(LocalDate.of(2024, 1, 1));
        assertThat(range("LAST_5_YEARS").from()).isEqualTo(LocalDate.of(2022, 1, 1));
        // Case and blanks do not matter; nothing means the endpoint's default.
        assertThat(DayRange.resolve(" this_year ", null, null, TODAY, "LAST_30_DAYS", DayRange.ONE_YEAR).preset())
                .isEqualTo("THIS_YEAR");
        assertThat(DayRange.resolve(null, null, null, TODAY, "LAST_30_DAYS", DayRange.ONE_YEAR).preset())
                .isEqualTo("LAST_30_DAYS");
        // A leap year: the previous year of 1 March 2029 is 2028 with 366 days.
        assertThat(DayRange.preset("PREVIOUS_YEAR", LocalDate.of(2029, 3, 1)).orElseThrow().length()).isEqualTo(366);
    }

    @Test
    void longestRangesAndBadRequests() {
        // Five calendar years always fit FIVE_YEARS, and THIS_YEAR / LAST_12_MONTHS always fit one year.
        for (LocalDate day = LocalDate.of(2027, 1, 1); day.isBefore(LocalDate.of(2033, 1, 1)); day = day.plusDays(1)) {
            assertThat(DayRange.preset("LAST_5_YEARS", day).orElseThrow().length()).isLessThanOrEqualTo(DayRange.FIVE_YEARS);
            assertThat(DayRange.preset("THIS_YEAR", day).orElseThrow().length()).isLessThanOrEqualTo(DayRange.ONE_YEAR);
            assertThat(DayRange.preset("LAST_12_MONTHS", day).orElseThrow().length())
                    .isLessThanOrEqualTo(DayRange.ONE_YEAR);
        }
        assertInvalidRange(() -> DayRange.resolve("LAST_3_YEARS", null, null, TODAY, "X", DayRange.ONE_YEAR),
                "at most 366 days");
        assertInvalidRange(() -> DayRange.resolve("CUSTOM", TODAY, null, TODAY, "X", 10), "needs 'from' and 'to'");
        assertInvalidRange(() -> DayRange.resolve("CUSTOM", TODAY, TODAY.minusDays(1), TODAY, "X", 10),
                "must not be before");
        assertInvalidRange(() -> DayRange.resolve("YESTERDAY", null, null, TODAY, "X", 10), "Unknown range YESTERDAY");
        assertThat(DayRange.resolve("custom", TODAY.minusDays(9), TODAY, TODAY, "X", 10).length()).isEqualTo(10);
        assertInvalidRange(() -> DayRange.resolve("CUSTOM", TODAY.minusDays(10), TODAY, TODAY, "X", 10), "at most 10");
    }

    @Test
    void thePreviousPeriodHasTheSameLengthAndEndsTheDayBefore() {
        DayRange week = range("LAST_7_DAYS");
        assertThat(week.previous())
                .isEqualTo(new DayRange("PREVIOUS_PERIOD", LocalDate.of(2026, 10, 24), LocalDate.of(2026, 10, 30)));
        // Not the calendar month before: the same number of days.
        DayRange thisMonth = range("THIS_MONTH");
        assertThat(thisMonth.previous().from()).isEqualTo(LocalDate.of(2026, 10, 26));
        assertThat(thisMonth.previous().to()).isEqualTo(LocalDate.of(2026, 10, 31));
        DayRange year = range("PREVIOUS_YEAR");
        assertThat(year.previous().length()).isEqualTo(365);
        assertThat(year.previous().from()).isEqualTo(LocalDate.of(2024, 1, 2));
    }

    @Test
    void indiaDaysAreQueriedWithUtcBoundaries() {
        DayRange day = new DayRange("CUSTOM", TODAY, TODAY);
        assertThat(day.startUtc(DayRange.INDIA)).isEqualTo(LocalDateTime.of(2026, 11, 5, 18, 30));
        assertThat(day.endUtc(DayRange.INDIA)).isEqualTo(LocalDateTime.of(2026, 11, 6, 18, 30));
        assertThat(day.eachDay()).containsExactly(TODAY);
    }

    // ------------------------------------------------------------------ intervals

    @Test
    void weeksStartOnMondayAndTheEndsAreCutToTheRange() {
        // Wed 28 Oct .. Fri 6 Nov 2026: the week of 26 Oct (cut), and the week of 2 Nov (cut at the end).
        DayRange range = new DayRange("CUSTOM", LocalDate.of(2026, 10, 28), TODAY);
        assertThat(Interval.WEEK.buckets(range)).containsExactly(
                new Bucket("2026-W44", LocalDate.of(2026, 10, 28), LocalDate.of(2026, 11, 1)),
                new Bucket("2026-W45", LocalDate.of(2026, 11, 2), TODAY));
        // ISO week-based years: 31 Dec 2026 is in week 53 of 2026, 1 Jan 2027 too, 4 Jan 2027 in week 1 of 2027.
        assertThat(Interval.WEEK.key(LocalDate.of(2026, 12, 31))).isEqualTo("2026-W53");
        assertThat(Interval.WEEK.key(LocalDate.of(2027, 1, 1))).isEqualTo("2026-W53");
        assertThat(Interval.WEEK.key(LocalDate.of(2027, 1, 4))).isEqualTo("2027-W01");
    }

    @Test
    void monthsAndYearsAreCalendarMonthsAndYears() {
        List<Bucket> months = Interval.MONTH.buckets(range("LAST_12_MONTHS"));
        assertThat(months).hasSize(12);
        assertThat(months.getFirst()).isEqualTo(new Bucket("2025-12", LocalDate.of(2025, 12, 1),
                LocalDate.of(2025, 12, 31)));
        assertThat(months.get(2)).isEqualTo(new Bucket("2026-02", LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 28)));
        assertThat(months.getLast()).isEqualTo(new Bucket("2026-11", LocalDate.of(2026, 11, 1), TODAY));

        List<Bucket> years = Interval.YEAR.buckets(range("LAST_5_YEARS"));
        assertThat(years).extracting(Bucket::key).containsExactly("2022", "2023", "2024", "2025", "2026");
        assertThat(years.getLast().end()).isEqualTo(TODAY);
        assertThat(Interval.DAY.buckets(range("LAST_7_DAYS"))).hasSize(7).allMatch(b -> b.start().equals(b.end()));
    }

    @Test
    void theBucketsCoverEveryDayOfTheRangeExactlyOnce() {
        DayRange range = new DayRange("CUSTOM", LocalDate.of(2024, 2, 27), LocalDate.of(2026, 3, 2));
        for (Interval interval : Interval.values()) {
            if (interval.count(range) > interval.maxBuckets()) {
                continue;
            }
            Timeline timeline = Timeline.of(range, interval);
            assertThat((long) timeline.size()).isEqualTo(interval.count(range));
            for (LocalDate day : range.eachDay()) {
                int index = timeline.indexOf(day);
                assertThat(index).as("%s %s", interval, day).isNotNegative();
                assertThat(timeline.buckets().get(index).contains(day)).isTrue();
            }
            assertThat(timeline.indexOf(range.from().minusDays(1))).isEqualTo(-1);
            assertThat(timeline.indexOf(range.to().plusDays(1))).isEqualTo(-1);
            long covered = timeline.buckets().stream()
                    .mapToLong(b -> b.end().toEpochDay() - b.start().toEpochDay() + 1).sum();
            assertThat(covered).isEqualTo(range.length());
        }
    }

    @Test
    void theIntervalFollowsTheRangeUnlessAskedAndTooManyPointsAreRefused() {
        assertThat(Interval.resolve(null, range("LAST_30_DAYS"))).isEqualTo(Interval.DAY);
        assertThat(Interval.resolve("", range("LAST_90_DAYS"))).isEqualTo(Interval.WEEK);
        assertThat(Interval.resolve(null, range("THIS_YEAR"))).isEqualTo(Interval.MONTH);
        assertThat(Interval.resolve(null, range("LAST_12_MONTHS"))).isEqualTo(Interval.MONTH);
        assertThat(Interval.resolve(null, range("LAST_5_YEARS"))).isEqualTo(Interval.YEAR);
        assertThat(Interval.resolve(" week ", range("THIS_YEAR"))).isEqualTo(Interval.WEEK);
        assertThat(Interval.resolve("DAY", range("PREVIOUS_YEAR"))).isEqualTo(Interval.DAY);

        assertThatThrownBy(() -> Interval.resolve("DAY", range("LAST_5_YEARS")))
                .isInstanceOfSatisfying(ApiException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(ex.getCode()).isEqualTo("INVALID_INTERVAL");
                    assertThat(ex.getMessage()).contains("at most 366 points");
                });
        assertThatThrownBy(() -> Interval.resolve("HOUR", range("TODAY")))
                .isInstanceOfSatisfying(ApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo("INVALID_INTERVAL"));
        assertThat(Interval.WEEK.count(range("LAST_5_YEARS"))).isLessThanOrEqualTo(Interval.WEEK.maxBuckets());
    }

    // ------------------------------------------------------------------ growth

    @Test
    void changeAgainstThePreviousPeriod() {
        Change up = Change.of(new BigDecimal("1500.00"), new BigDecimal("1200.00"));
        assertThat(up.change()).isEqualByComparingTo("300.00");
        assertThat(up.changePercent()).isEqualByComparingTo("25.0");
        assertThat(up.trend()).isEqualTo(Trend.UP);

        Change down = Change.of(2, 3);
        assertThat(down.change()).isEqualByComparingTo("-1");
        assertThat(down.changePercent()).isEqualByComparingTo("-33.3");
        assertThat(down.trend()).isEqualTo(Trend.DOWN);

        Change fromNothing = Change.of(5, 0);
        assertThat(fromNothing.changePercent()).isNull();
        assertThat(fromNothing.trend()).isEqualTo(Trend.UP);

        Change nothing = Change.of(0, 0);
        assertThat(nothing.changePercent()).isEqualByComparingTo("0.0");
        assertThat(nothing.trend()).isEqualTo(Trend.FLAT);

        // A negative previous value (net revenue after big refunds): the growth is measured against its size.
        Change recovered = Change.of(new BigDecimal("100"), new BigDecimal("-200"));
        assertThat(recovered.changePercent()).isEqualByComparingTo("150.0");
        assertThat(recovered.trend()).isEqualTo(Trend.UP);

        assertThat(Change.percent(1, 3)).isEqualByComparingTo("33.3");
        assertThat(Change.percent(2, 3)).isEqualByComparingTo("66.7");
        assertThat(Change.percent(0, 0)).isEqualByComparingTo("0.0");
        assertThat(Change.percent(new BigDecimal("50"), new BigDecimal("400"))).isEqualByComparingTo("12.5");
    }

    private static DayRange range(String preset) {
        return DayRange.preset(preset, TODAY).orElseThrow();
    }

    private static void assertInvalidRange(Runnable call, String messagePart) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, ex -> {
            assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(ex.getCode()).isEqualTo("INVALID_RANGE");
            assertThat(ex.getMessage()).contains(messagePart);
        });
    }
}
