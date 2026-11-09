package com.flighthotel.reporting.export;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.flighthotel.reporting.audit.AuditLogStore.AuditLogEntry;
import com.flighthotel.reporting.export.ExportFileWriter.Plan;
import com.flighthotel.reporting.export.ExportFileWriter.Result;

/** The files of background exports, opened the way a spreadsheet program opens them (Apache POI). */
class ExportFileWriterTest {

    private static final Instant EXPORTED_AT = Instant.parse("2026-11-09T08:35:00Z"); // 14:05 in India
    private static final List<String[]> FILTERS = List.<String[]>of(new String[] {"Entity type", "BOOKING"},
            new String[] {"Order", "Newest first"});

    @TempDir
    Path work;

    @Test
    void theColumnsAreTheWebExportColumns() {
        // Keep equal to EXPORT_COLUMNS in frontend/src/features/admin/audit/AdminAuditLogsPage.tsx.
        assertThat(AuditExportColumns.COLUMNS).extracting(AuditExportColumns.Column::header).containsExactly(
                "When", "Action", "Action code", "Entity type", "Entity id", "Actor", "Actor id", "Details",
                "Service", "IP address", "Correlation id");
    }

    @Test
    void excelWithMoreRowsThanAPartIsAZipOfPartsThatEachOpen() throws Exception {
        Path file = work.resolve("export.tmp");
        Plan plan = plan(ExportFormat.XLSX, 25, 10);
        Result result = write(file, plan, entries(25), 7);

        assertThat(result).isEqualTo(new Result("audit-logs-2026-11-09.zip", "application/zip", 3, 25));
        Map<String, byte[]> parts = unzip(Files.readAllBytes(file));
        assertThat(parts.keySet()).containsExactly("audit-logs-2026-11-09-part-01-of-3.xlsx",
                "audit-logs-2026-11-09-part-02-of-3.xlsx", "audit-logs-2026-11-09-part-03-of-3.xlsx");

        List<String> order = new ArrayList<>();
        int partNumber = 0;
        for (byte[] part : parts.values()) {
            partNumber++;
            try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(part))) {
                XSSFSheet sheet = workbook.getSheetAt(0);
                int rows = partNumber < 3 ? 10 : 5;
                assertThat(sheet.getSheetName()).isEqualTo("Audit logs");
                assertThat(texts(sheet.getRow(0))).containsExactly("When", "Action", "Action code", "Entity type",
                        "Entity id", "Actor", "Actor id", "Details", "Service", "IP address", "Correlation id");
                assertThat(sheet.getLastRowNum()).isEqualTo(rows);
                // The header stays in view, has filter buttons over the rows, and is printed on every page.
                assertThat(sheet.getPaneInformation().isFreezePane()).isTrue();
                assertThat(sheet.getPaneInformation().getHorizontalSplitPosition()).isEqualTo((short) 1);
                assertThat(sheet.getCTWorksheet().getAutoFilter().getRef()).isEqualTo("A1:K" + (rows + 1));
                assertThat(sheet.getRepeatingRows().formatAsString()).isEqualTo("1:1");
                for (int r = 1; r <= rows; r++) {
                    order.add(sheet.getRow(r).getCell(10).getStringCellValue());
                }
                Sheet about = workbook.getSheetAt(1);
                assertThat(about.getSheetName()).isEqualTo("About this export");
                assertThat(aboutValue(about, "Rows")).isEqualTo(String.valueOf(rows));
                assertThat(aboutValue(about, "Exported")).isEqualTo("9 Nov 2026, 14:05");
                assertThat(aboutValue(about, "Exported by")).isEqualTo("Asha Rao (Admin)");
                assertThat(aboutValue(about, "Entity type")).isEqualTo("BOOKING");
            }
        }
        // Every entry once, in the order read (newest first), across the parts.
        assertThat(order).containsExactlyElementsOf(entries(25).stream().map(AuditLogEntry::correlationId).toList());
        try (XSSFWorkbook second = new XSSFWorkbook(new ByteArrayInputStream(parts.values().stream().skip(1)
                .findFirst().orElseThrow()))) {
            assertThat(aboutValue(second.getSheetAt(1), "Rows included"))
                    .startsWith("Part 2 of 3: entries 11 to 20 of 25, recorded up to 9 Nov 2026, 14:00");
        }
    }

    @Test
    void excelUpToOnePartIsOneWorkbookWithRealDatesAndCleanText() throws Exception {
        Path file = work.resolve("export.tmp");
        List<AuditLogEntry> entries = new ArrayList<>(entries(3));
        entries.set(1, entry(1, Instant.parse("2026-11-08T20:45:30Z"), Map.of("note", "a <b> & \"c\"\u0001 d")));
        Result result = write(file, plan(ExportFormat.XLSX, 3, 10), entries, 100);

        assertThat(result).isEqualTo(new Result("audit-logs-2026-11-09.xlsx", StreamingXlsxWriter.CONTENT_TYPE, 1, 3));
        try (XSSFWorkbook workbook = new XSSFWorkbook(Files.newInputStream(file))) {
            Sheet sheet = workbook.getSheetAt(0);
            Row row = sheet.getRow(2);
            // A real date and time (India time, to the minute) with a date format, not text.
            assertThat(row.getCell(0).getCellType()).isEqualTo(CellType.NUMERIC);
            assertThat(DateUtil.isCellDateFormatted(row.getCell(0))).isTrue();
            assertThat(row.getCell(0).getCellStyle().getDataFormatString()).isEqualTo("dd mmm yyyy hh:mm");
            assertThat(row.getCell(0).getLocalDateTimeCellValue()).isEqualTo(LocalDateTime.of(2026, 11, 9, 2, 15));
            assertThat(row.getCell(1).getStringCellValue()).isEqualTo("Booking cancelled");
            assertThat(row.getCell(5).getStringCellValue()).isEqualTo("Support agent");
            // Markup characters are kept; a control character XML cannot hold is dropped.
            assertThat(row.getCell(7).getStringCellValue()).isEqualTo("note: a <b> & \"c\" d");
            assertThat(sheet.getRow(1).getCell(5).getStringCellValue()).isEqualTo("System");
            assertThat(aboutValue(workbook.getSheetAt(1), "Rows included"))
                    .isEqualTo("Every matching entry recorded up to 9 Nov 2026, 14:00 (India time)");
        }
    }

    @Test
    void anExportWithNoRowsStillOpens() throws Exception {
        Path file = work.resolve("export.tmp");
        Result result = write(file, plan(ExportFormat.XLSX, 0, 10), List.of(), 10);

        assertThat(result.rows()).isZero();
        try (XSSFWorkbook workbook = new XSSFWorkbook(Files.newInputStream(file))) {
            assertThat(workbook.getSheetAt(0).getLastRowNum()).isZero();
        }
    }

    @Test
    void csvIsQuotedGuardedAgainstFormulasAndInIndiaTime() throws Exception {
        Path file = work.resolve("export.tmp");
        // A value that a spreadsheet would run as a formula, and quotes inside a value.
        List<AuditLogEntry> entries = List.of(new AuditLogEntry("id-0", Instant.parse("2026-11-09T08:35:59Z"),
                "booking-service", "=cmd|' /C calc'!A0", List.of(), "BOOKING_CANCELLED", "BOOKING", "booking-0",
                Map.of("reason", "=HYPERLINK(\"x\")"), "203.0.113.7", "corr-00"));
        Result result = write(file, plan(ExportFormat.CSV, 1, 10), entries, 10);

        assertThat(result).isEqualTo(new Result("audit-logs-2026-11-09.csv", "text/csv;charset=UTF-8", 1, 1));
        byte[] bytes = Files.readAllBytes(file);
        assertThat(new byte[] {bytes[0], bytes[1], bytes[2]}).containsExactly(0xef, 0xbb, 0xbf);
        String[] lines = new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8).split("\r\n");
        assertThat(lines[0]).isEqualTo("\"When\",\"Action\",\"Action code\",\"Entity type\",\"Entity id\",\"Actor\","
                + "\"Actor id\",\"Details\",\"Service\",\"IP address\",\"Correlation id\"");
        assertThat(lines[1]).startsWith("2026-11-09 14:05,\"Booking cancelled\",\"BOOKING_CANCELLED\",\"Booking\",")
                .contains(",\"System\",\"'=cmd|' /C calc'!A0\",")
                .contains(",\"reason: =HYPERLINK(\"\"x\"\")\",")
                .endsWith(",\"booking-service\",\"203.0.113.7\",\"corr-00\"");
        assertThat(lines).hasSize(2);
    }

    @Test
    void csvWithMoreRowsThanAPartIsZipped() throws Exception {
        Path file = work.resolve("export.tmp");
        Result result = write(file, plan(ExportFormat.CSV, 25, 10), entries(25), 7);

        assertThat(result).isEqualTo(new Result("audit-logs-2026-11-09.zip", "application/zip", 1, 25));
        Map<String, byte[]> files = unzip(Files.readAllBytes(file));
        assertThat(files.keySet()).containsExactly("audit-logs-2026-11-09.csv");
        assertThat(new String(files.get("audit-logs-2026-11-09.csv"), StandardCharsets.UTF_8).split("\r\n"))
                .hasSize(26);
    }

    @Test
    void excelSerialsAreDaysSince1899WithTheTimeAsAFraction() {
        assertThat(StreamingXlsxWriter.excelSerial(LocalDateTime.of(2026, 11, 9, 0, 0))).isEqualTo("46335");
        assertThat(StreamingXlsxWriter.excelSerial(LocalDateTime.of(2026, 11, 9, 12, 0))).isEqualTo("46335.5");
        assertThat(StreamingXlsxWriter.columnName(10)).isEqualTo("K");
        assertThat(StreamingXlsxWriter.columnName(26)).isEqualTo("AA");
    }

    // ------------------------------------------------------------------ helpers

    private static Plan plan(ExportFormat format, long total, int rowsPerPart) {
        return new Plan("audit-logs-2026-11-09", format, total, rowsPerPart, EXPORTED_AT, "Asha Rao (Admin)",
                Instant.parse("2026-11-09T08:30:00Z"), FILTERS);
    }

    private static Result write(Path file, Plan plan, List<AuditLogEntry> entries, int batchSize) throws IOException {
        try (ExportFileWriter writer = new ExportFileWriter(file, plan, AuditExportColumns.COLUMNS)) {
            for (int from = 0; from < entries.size(); from += batchSize) {
                writer.accept(entries.subList(from, Math.min(entries.size(), from + batchSize)));
            }
            return writer.finish();
        }
    }

    /** Newest first, one minute apart. */
    private static List<AuditLogEntry> entries(int count) {
        List<AuditLogEntry> entries = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            entries.add(entry(i, Instant.parse("2026-11-09T08:00:00Z").minusSeconds(60L * i),
                    Map.of("refundAmount", "3150.00")));
        }
        return entries;
    }

    private static AuditLogEntry entry(int i, Instant at, Map<String, String> details) {
        return new AuditLogEntry("id-" + i, at, "booking-service", "user-" + i,
                i % 2 == 0 ? List.of() : List.of("SUPPORT_AGENT"), "BOOKING_CANCELLED", "BOOKING", "booking-" + i,
                details, "203.0.113.7", String.format("corr-%02d", i));
    }

    private static List<String> texts(Row row) {
        List<String> texts = new ArrayList<>();
        row.forEach(cell -> texts.add(cell.getStringCellValue()));
        return texts;
    }

    private static String aboutValue(Sheet about, String label) {
        for (Row row : about) {
            if (row.getCell(0) != null && label.equals(row.getCell(0).getStringCellValue())) {
                var value = row.getCell(1);
                return value.getCellType() == CellType.NUMERIC ? String.valueOf((long) value.getNumericCellValue())
                        : value.getStringCellValue();
            }
        }
        throw new AssertionError("No " + label + " in the about sheet");
    }

    private static Map<String, byte[]> unzip(byte[] zip) throws IOException {
        Map<String, byte[]> files = new LinkedHashMap<>();
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(zip))) {
            ZipEntry entry;
            while ((entry = in.getNextEntry()) != null) {
                files.put(entry.getName(), readAll(in));
            }
        }
        return files;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        return in.readAllBytes();
    }
}
