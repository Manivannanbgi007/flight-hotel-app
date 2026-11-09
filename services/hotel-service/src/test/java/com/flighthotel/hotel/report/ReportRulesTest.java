package com.flighthotel.hotel.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.LocalDate;

import org.junit.jupiter.api.Test;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.hotel.dto.ReportDtos.DateRange;

/** Date ranges (§14.0), the even split of a stay's room charges, and the CSV cell rules. */
class ReportRulesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 5);

    @Test
    void presetsAreIndiaDaysWithBothEndsIncluded() {
        assertThat(ReportRanges.resolve(null, null, null, TODAY))
                .isEqualTo(new DateRange("LAST_30_DAYS", LocalDate.of(2026, 10, 7), TODAY));
        assertThat(ReportRanges.resolve("TODAY", null, null, TODAY)).isEqualTo(new DateRange("TODAY", TODAY, TODAY));
        assertThat(ReportRanges.resolve("last_7_days", null, null, TODAY).from()).isEqualTo(LocalDate.of(2026, 10, 30));
        assertThat(ReportRanges.resolve("LAST_14_DAYS", null, null, TODAY).from()).isEqualTo(LocalDate.of(2026, 10, 23));
        assertThat(ReportRanges.resolve("THIS_MONTH", null, null, TODAY))
                .isEqualTo(new DateRange("THIS_MONTH", LocalDate.of(2026, 11, 1), TODAY));
        assertThat(ReportRanges.resolve("PREVIOUS_MONTH", null, null, LocalDate.of(2026, 3, 31)))
                .isEqualTo(new DateRange("PREVIOUS_MONTH", LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 28)));
        // from/to only matter for CUSTOM.
        assertThat(ReportRanges.resolve("TODAY", LocalDate.of(2020, 1, 1), null, TODAY).from()).isEqualTo(TODAY);
        assertThat(ReportRanges.resolve("CUSTOM", TODAY.minusDays(365), TODAY, TODAY).from())
                .isEqualTo(TODAY.minusDays(365));
    }

    @Test
    void badRangesAreRefused() {
        for (Runnable bad : new Runnable[] {
                () -> ReportRanges.resolve("CUSTOM", TODAY, null, TODAY),
                () -> ReportRanges.resolve("CUSTOM", TODAY, TODAY.minusDays(1), TODAY),
                () -> ReportRanges.resolve("CUSTOM", TODAY.minusDays(366), TODAY, TODAY),
                () -> ReportRanges.resolve("YESTERDAY", null, null, TODAY)}) {
            assertThatThrownBy(bad::run).isInstanceOf(ApiException.class)
                    .satisfies(ex -> assertThat(((ApiException) ex).getCode()).isEqualTo("INVALID_RANGE"));
        }
    }

    @Test
    void aStaysRoomChargesAreSpreadEvenlyAndAddUpToTheCent() {
        BigDecimal subtotal = new BigDecimal("1000.00");
        assertThat(HotelFigures.nightShare(subtotal, 3, 0)).isEqualByComparingTo("333.33");
        assertThat(HotelFigures.nightShare(subtotal, 3, 1)).isEqualByComparingTo("333.33");
        assertThat(HotelFigures.nightShare(subtotal, 3, 2)).isEqualByComparingTo("333.34");
        assertThat(HotelFigures.nightShare(new BigDecimal("7000.00"), 1, 0)).isEqualByComparingTo("7000.00");
        assertThat(HotelFigures.percent(9, 14)).isEqualByComparingTo("64.3");
        assertThat(HotelFigures.percent(0, 0)).isEqualByComparingTo("0.0");
    }

    @Test
    void csvCellsAreQuotedOnlyWhenNeededAndNeverRunAsFormulas() {
        assertThat(CsvFile.escape(new BigDecimal("1944.40"))).isEqualTo("1944.40");
        assertThat(CsvFile.escape("Sea Breeze, Goa")).isEqualTo("\"Sea Breeze, Goa\"");
        assertThat(CsvFile.escape("The \"Inn\"")).isEqualTo("\"The \"\"Inn\"\"\"");
        assertThat(CsvFile.escape("=HYPERLINK(\"x\")")).isEqualTo("\"'=HYPERLINK(\"\"x\"\")\"");
        assertThat(CsvFile.escape(null)).isEmpty();
    }
}
