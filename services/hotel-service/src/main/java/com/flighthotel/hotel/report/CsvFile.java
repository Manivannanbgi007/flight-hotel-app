package com.flighthotel.hotel.report;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.http.HttpStatus;

import com.flighthotel.common.error.ApiException;

/**
 * A report as a CSV download: UTF-8 with a byte order mark (so Excel shows ₹ and accented names correctly), comma
 * separated, CRLF line ends, values quoted only when needed (RFC 4180). Numbers are plain ({@code 1944.44}), dates
 * ISO ({@code 2026-11-05}), so spreadsheets read them as numbers and dates.
 */
public record CsvFile(String filename, byte[] content) {

    public static final String CONTENT_TYPE = "text/csv;charset=UTF-8";
    private static final byte[] BOM = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};

    /** Only CSV is offered for hotel reports; anything else: {@code 400 UNSUPPORTED_FORMAT}. */
    public static void requireCsv(String format) {
        if (format != null && !"csv".equals(format.strip().toLowerCase(Locale.ROOT))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_FORMAT",
                    "Hotel reports can be exported as csv only.", Map.of());
        }
    }

    public static CsvFile of(String filename, List<String> header, List<List<Object>> rows) {
        StringBuilder text = new StringBuilder();
        line(text, header.stream().map(Object.class::cast).toList());
        rows.forEach(row -> line(text, row));
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bytes.writeBytes(BOM);
        bytes.writeBytes(text.toString().getBytes(StandardCharsets.UTF_8));
        return new CsvFile(filename, bytes.toByteArray());
    }

    /** {@code attachment; filename="…"} (names are made of ASCII letters, digits and dashes only). */
    public String contentDisposition() {
        return "attachment; filename=\"" + filename + "\"";
    }

    private static void line(StringBuilder text, List<Object> values) {
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) {
                text.append(',');
            }
            text.append(escape(values.get(i)));
        }
        text.append("\r\n");
    }

    static String escape(Object value) {
        if (value == null) {
            return "";
        }
        String text = value instanceof BigDecimal decimal ? decimal.toPlainString() : value.toString();
        // Cells starting with = + - @ would be run as formulas by spreadsheets (CSV injection): quote them as text.
        boolean formula = !text.isEmpty() && "=+-@".indexOf(text.charAt(0)) >= 0
                && !(value instanceof Number);
        if (formula) {
            text = "'" + text;
        }
        if (text.contains(",") || text.contains("\"") || text.contains("\n") || text.contains("\r")) {
            return "\"" + text.replace("\"", "\"\"") + "\"";
        }
        return text;
    }
}
