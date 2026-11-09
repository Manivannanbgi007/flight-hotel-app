package com.flighthotel.reporting.export;

import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import com.flighthotel.common.text.IndianDigits;
import com.flighthotel.reporting.audit.AuditLogStore.AuditLogEntry;
import com.flighthotel.reporting.export.AuditExportColumns.Column;

/**
 * Writes the file of an export as its rows arrive, to one file on disk:
 * <ul>
 * <li>Excel up to {@code rowsPerPart} rows: one .xlsx;</li>
 * <li>Excel with more rows: a .zip of .xlsx parts of {@code rowsPerPart} rows each (Excel holds 1,048,576 rows a
 * sheet), each with its own header and "About this export" sheet saying which rows it holds;</li>
 * <li>CSV: one .csv, inside a .zip when it has more than {@code rowsPerPart} rows (text shrinks about five times).</li>
 * </ul>
 */
final class ExportFileWriter implements Closeable {

    static final String ZIP_TYPE = "application/zip";
    private static final String SHEET = "Audit logs";

    /**
     * @param baseName   file name without extension, e.g. {@code audit-logs-2026-11-09}
     * @param totalRows  the rows the export will have (counted before writing)
     * @param exportedAt shown in the file
     * @param filters    label and value pairs for "Filters and sorting"
     */
    record Plan(String baseName, ExportFormat format, long totalRows, int rowsPerPart, Instant exportedAt,
            String exportedBy, Instant asOf, List<String[]> filters) {

        /** The number of files: Excel parts (1 = a plain .xlsx); a CSV is always one file. */
        int parts() {
            if (format == ExportFormat.CSV || totalRows <= rowsPerPart) {
                return 1;
            }
            return (int) ((totalRows + rowsPerPart - 1) / rowsPerPart);
        }

        boolean zipped() {
            return format == ExportFormat.XLSX ? parts() > 1 : totalRows > rowsPerPart;
        }
    }

    record Result(String fileName, String contentType, int parts, long rows) {
    }

    private final Plan plan;
    private final List<Column> columns;
    private final OutputStream file;
    private final ZipOutputStream zip;
    private StreamingXlsxWriter part;
    private StreamingCsvWriter csv;
    private int partNumber;
    private long partFirstRow = 1;
    private long written;

    ExportFileWriter(Path target, Plan plan, List<Column> columns) throws IOException {
        this.plan = plan;
        this.columns = List.copyOf(columns);
        this.file = new BufferedOutputStream(Files.newOutputStream(target), 1 << 16);
        if (plan.zipped()) {
            this.zip = new ZipOutputStream(new StreamingXlsxWriter.NonClosing(file));
            // Excel parts are zips already; a CSV is compressed here.
            zip.setLevel(plan.format() == ExportFormat.XLSX ? Deflater.NO_COMPRESSION : Deflater.BEST_SPEED);
        } else {
            this.zip = null;
        }
        if (plan.format() == ExportFormat.CSV) {
            if (zip != null) {
                zip.putNextEntry(new ZipEntry(plan.baseName() + ".csv"));
            }
            this.csv = new StreamingCsvWriter(zip != null ? zip : file, columns);
        }
    }

    long rowsWritten() {
        return written;
    }

    void accept(List<AuditLogEntry> batch) throws IOException {
        for (AuditLogEntry entry : batch) {
            List<Object> values = new ArrayList<>(columns.size());
            for (Column column : columns) {
                values.add(column.value().apply(entry));
            }
            if (csv != null) {
                csv.row(values);
            } else {
                if (part == null) {
                    startPart();
                } else if (part.rows() >= plan.rowsPerPart() && partNumber < plan.parts()) {
                    finishPart();
                    startPart();
                } else if (part.rows() >= ExportProperties.EXCEL_MAX_DATA_ROWS) {
                    throw new ExportFailedException("More entries than counted: the audit log changed while "
                            + "exporting. Start the export again.");
                }
                part.row(values);
            }
            written++;
        }
    }

    Result finish() throws IOException {
        String fileName;
        String contentType;
        if (csv != null) {
            csv.finish();
            fileName = plan.baseName() + (zip != null ? ".zip" : ".csv");
            contentType = zip != null ? ZIP_TYPE : StreamingCsvWriter.CONTENT_TYPE;
        } else {
            if (part == null) {
                startPart();
            }
            finishPart();
            fileName = plan.baseName() + (zip != null ? ".zip" : ".xlsx");
            contentType = zip != null ? ZIP_TYPE : StreamingXlsxWriter.CONTENT_TYPE;
        }
        if (zip != null) {
            zip.closeEntry();
            zip.finish();
        }
        file.flush();
        return new Result(fileName, contentType, csv != null ? 1 : partNumber, written);
    }

    @Override
    public void close() throws IOException {
        file.close();
    }

    private void startPart() throws IOException {
        partNumber++;
        if (zip != null) {
            zip.putNextEntry(new ZipEntry(partName(partNumber)));
        }
        part = new StreamingXlsxWriter(zip != null ? zip : file, SHEET, columns, plan.exportedAt(), "Audit logs");
    }

    private void finishPart() throws IOException {
        long rows = part.rows();
        String scope;
        if (zip == null) {
            scope = "Every matching entry recorded up to " + ExportTime.shown(plan.asOf()) + " (India time)";
        } else {
            scope = "Part " + partNumber + " of " + plan.parts() + ": entries " + count(partFirstRow) + " to "
                    + count(partFirstRow + rows - 1) + " of " + count(plan.totalRows()) + ", recorded up to "
                    + ExportTime.shown(plan.asOf()) + " (India time)";
        }
        part.finish(new StreamingXlsxWriter.About("Audit logs", "Admin portal", ExportTime.shown(plan.exportedAt()),
                plan.exportedBy(), scope, plan.filters()));
        if (zip != null) {
            zip.closeEntry();
        }
        partFirstRow += rows;
        part = null;
    }

    /** {@code audit-logs-2026-11-09-part-03-of-10.xlsx}: sorts in order in any file list. */
    private String partName(int number) {
        int digits = Math.max(2, Integer.toString(plan.parts()).length());
        return plan.baseName() + "-part-" + String.format("%0" + digits + "d", number) + "-of-" + plan.parts()
                + ".xlsx";
    }

    private static String count(long value) {
        return IndianDigits.group(Long.toString(value));
    }

    /** The export cannot be written; the message is safe to show to the admin. */
    static final class ExportFailedException extends RuntimeException {

        ExportFailedException(String message) {
            super(message);
        }
    }
}
