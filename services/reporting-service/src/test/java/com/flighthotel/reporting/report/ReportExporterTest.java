package com.flighthotel.reporting.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

import com.flighthotel.reporting.report.ReportService.Column;
import com.flighthotel.reporting.report.ReportService.ReportRows;
import com.flighthotel.reporting.report.ReportService.Type;

/**
 * Report files: CSV that Excel opens correctly and can never run as formulas (CSV injection), and a PDF that
 * survives names with markup in them.
 */
class ReportExporterTest {

    private static final ReportRange RANGE = new ReportRange("CUSTOM", LocalDate.of(2026, 11, 1),
            LocalDate.of(2026, 11, 5));
    private static final List<Column> COLUMNS = List.of(
            new Column("reference", "Reference", Type.TEXT),
            new Column("customer", "Customer", Type.TEXT),
            new Column("createdAt", "Created", Type.DATETIME),
            new Column("amount", "Amount", Type.MONEY),
            new Column("nights", "Nights", Type.NUMBER),
            new Column("checkIn", "Check-in", Type.DATE));

    private final ReportExporter exporter =
            new ReportExporter(Clock.fixed(Instant.parse("2026-11-06T04:30:00Z"), ZoneOffset.UTC));

    @Test
    void cellsThatASpreadsheetWouldRunAsAFormulaGetAnApostrophe() {
        assertThat(ReportExporter.escape("=1+1")).isEqualTo("'=1+1");
        assertThat(ReportExporter.escape("+91 98000 00000")).isEqualTo("'+91 98000 00000");
        assertThat(ReportExporter.escape("@SUM(A1:A9)")).isEqualTo("'@SUM(A1:A9)");
        assertThat(ReportExporter.escape("-2+3")).isEqualTo("'-2+3");
        assertThat(ReportExporter.escape("\t=cmd")).isEqualTo("'\t=cmd");
        // Quoted as well when needed: the apostrophe stays inside the quotes.
        assertThat(ReportExporter.escape("=HYPERLINK(\"http://evil\",\"x\")"))
                .isEqualTo("\"'=HYPERLINK(\"\"http://evil\"\",\"\"x\"\")\"");
        assertThat(ReportExporter.escape("\r=cmd")).isEqualTo("\"'\r=cmd\"");
    }

    @Test
    void numbersStayNumbersAndOtherCellsAreQuotedOnlyWhenNeeded() {
        assertThat(ReportExporter.escape("-250.50")).isEqualTo("-250.50");
        assertThat(ReportExporter.escape("-7")).isEqualTo("-7");
        assertThat(ReportExporter.escape("Sea Breeze Resort")).isEqualTo("Sea Breeze Resort");
        assertThat(ReportExporter.escape("Rao, Asha")).isEqualTo("\"Rao, Asha\"");
        assertThat(ReportExporter.escape("The \"Inn\"")).isEqualTo("\"The \"\"Inn\"\"\"");
        assertThat(ReportExporter.escape("line one\nline two")).isEqualTo("\"line one\nline two\"");
        assertThat(ReportExporter.escape("")).isEmpty();
        assertThat(ReportExporter.escape(null)).isEmpty();
    }

    @Test
    void aCsvHasABomPlainNumbersIndiaTimesAndATotalRow() {
        byte[] csv = exporter.csv(report("Bookings"));

        assertThat(csv).startsWith((byte) 0xEF, (byte) 0xBB, (byte) 0xBF);
        assertThat(new String(csv, StandardCharsets.UTF_8)).isEqualTo("﻿"
                + "Reference,Customer,Created,Amount,Nights,Check-in\r\n"
                // 18:45 UTC is 00:15 the next day in India; money has two decimals and no grouping.
                + "HT-1,'=cmd|' /C calc'!A0,2026-11-06 00:15,123456.50,2,2026-12-10\r\n"
                + "HT-2,\"Rao, Asha \"\"VIP\"\"\",,-250.01,,\r\n"
                + "Total,,,123206.49,2,\r\n");
        assertThat(ReportExporter.fileName(report("Bookings"), "csv")).isEqualTo("bookings-2026-11-01-2026-11-05.csv");
    }

    @Test
    void aReportWithoutTotalsHasNoTotalRow() {
        ReportRows rows = new ReportRows("customers", "Customers", RANGE, COLUMNS.subList(0, 2),
                List.of(Map.of("reference", "C-1", "customer", "Asha Rao")), Map.of());
        assertThat(new String(exporter.csv(rows), StandardCharsets.UTF_8))
                .isEqualTo("﻿Reference,Customer\r\nC-1,Asha Rao\r\n");
    }

    @Test
    void aPdfShowsMarkupInNamesAsTextWithIndianAmounts() throws Exception {
        byte[] pdf = exporter.pdf(report("Bookings & <Refunds>"));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document);
            assertThat(text).contains("Bookings & <Refunds> report")
                    .contains("1 Nov 2026 to 5 Nov 2026 (India time)")
                    .contains("2 rows")
                    .contains("generated 6 Nov 2026, 10:00")
                    .contains("Rao, Asha \"VIP\"")
                    .contains("₹1,23,456.50")
                    .contains("Total");
        }
    }

    private static ReportRows report(String title) {
        Map<String, Object> first = new HashMap<>();
        first.put("reference", "HT-1");
        first.put("customer", "=cmd|' /C calc'!A0");
        first.put("createdAt", Instant.parse("2026-11-05T18:45:00Z"));
        first.put("amount", new BigDecimal("123456.5"));
        first.put("nights", 2);
        first.put("checkIn", LocalDate.of(2026, 12, 10));
        Map<String, Object> second = new HashMap<>();
        second.put("reference", "HT-2");
        second.put("customer", "Rao, Asha \"VIP\"");
        second.put("amount", new BigDecimal("-250.005"));
        return new ReportRows("bookings", title, RANGE, COLUMNS, List.of(first, second),
                Map.of("amount", new BigDecimal("123206.49"), "nights", 2));
    }
}
