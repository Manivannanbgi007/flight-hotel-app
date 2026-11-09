package com.flighthotel.reporting.export;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

import com.flighthotel.reporting.export.AuditExportColumns.Column;

/**
 * CSV the way the web export writes it ({@code frontend/src/lib/export/csv.ts}): UTF-8 with a byte order mark (so Excel
 * shows ₹ and names correctly), CRLF lines, every text quoted, dates as {@code 2026-11-09 14:05} (India time). A text
 * starting with {@code = + - @}, a tab or a carriage return gets a leading apostrophe, so a spreadsheet never runs it
 * as a formula (CSV injection).
 */
final class StreamingCsvWriter {

    static final String CONTENT_TYPE = "text/csv;charset=UTF-8";

    private final Writer out;
    private long rows;

    /** Writes the byte order mark and the header. {@code target} is not closed by {@link #finish}. */
    StreamingCsvWriter(OutputStream target, List<Column> columns) throws IOException {
        this.out = new BufferedWriter(new OutputStreamWriter(new StreamingXlsxWriter.NonClosing(target),
                StandardCharsets.UTF_8), 1 << 16);
        out.write('﻿');
        for (int i = 0; i < columns.size(); i++) {
            if (i > 0) {
                out.write(',');
            }
            text(columns.get(i).header());
        }
        out.write("\r\n");
    }

    long rows() {
        return rows;
    }

    void row(List<Object> values) throws IOException {
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) {
                out.write(',');
            }
            Object value = values.get(i);
            if (value instanceof Instant instant) {
                out.write(ExportTime.plain(instant));
            } else if (value != null) {
                text(value.toString());
            }
        }
        out.write("\r\n");
        rows++;
    }

    void finish() throws IOException {
        out.flush();
    }

    private void text(String value) throws IOException {
        out.write('"');
        if (!value.isEmpty() && "=+-@\t\r".indexOf(value.charAt(0)) >= 0) {
            out.write('\'');
        }
        out.write(value.replace("\"", "\"\""));
        out.write('"');
    }
}
