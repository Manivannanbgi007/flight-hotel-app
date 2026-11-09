package com.flighthotel.reporting.report;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.flighthotel.common.text.IndianDigits;
import com.flighthotel.reporting.report.ReportService.Column;
import com.flighthotel.reporting.report.ReportService.ReportRows;
import com.flighthotel.reporting.report.ReportService.Type;
import com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;

/**
 * Report exports. CSV: UTF-8 with a byte order mark so Excel shows ₹ and names correctly, plain numbers (no grouping)
 * so they stay numbers, India times; a cell starting with {@code = + - @} gets a leading apostrophe so a spreadsheet
 * never runs it as a formula (CSV injection). PDF: an A4 landscape table with the totals, Inter (the web app's font)
 * embedded, with the rupee sign.
 */
@Component
public class ReportExporter {

    private static final String FONT = "Inter";
    private static final DateTimeFormatter INDIA_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
            .withZone(ReportRange.INDIA);
    private static final DateTimeFormatter PDF_TIME = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.ENGLISH)
            .withZone(ReportRange.INDIA);
    private static final DateTimeFormatter PDF_DATE = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    private final Clock clock;

    public ReportExporter(Clock clock) {
        this.clock = clock;
    }

    public static String fileName(ReportRows rows, String extension) {
        return rows.report() + "-" + rows.range().label() + "." + extension;
    }

    // ------------------------------------------------------------------ CSV

    public byte[] csv(ReportRows report) {
        StringBuilder out = new StringBuilder("﻿");
        List<Column> columns = report.columns();
        line(out, columns.stream().map(Column::label).toList());
        for (Map<String, Object> row : report.rows()) {
            line(out, columns.stream().map(column -> csvValue(column, row.get(column.key()))).toList());
        }
        if (!report.totals().isEmpty()) {
            line(out, columns.stream().map(column -> column == columns.getFirst() ? "Total"
                    : csvValue(column, report.totals().get(column.key()))).toList());
        }
        return out.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static String csvValue(Column column, Object value) {
        if (value == null) {
            return "";
        }
        return switch (column.type()) {
            case MONEY -> ((BigDecimal) value).setScale(2, java.math.RoundingMode.HALF_UP).toPlainString();
            case DATETIME -> INDIA_TIME.format((Instant) value);
            default -> value.toString();
        };
    }

    private static void line(StringBuilder out, List<String> cells) {
        for (int i = 0; i < cells.size(); i++) {
            if (i > 0) {
                out.append(',');
            }
            out.append(escape(cells.get(i)));
        }
        out.append("\r\n");
    }

    /** A CSV cell: quoted when needed, and never a formula. */
    public static String escape(String cell) {
        String text = cell == null ? "" : cell;
        if (!text.isEmpty() && "=+-@\t\r".indexOf(text.charAt(0)) >= 0 && !isNumber(text)) {
            text = "'" + text;
        }
        if (text.contains(",") || text.contains("\"") || text.contains("\n") || text.contains("\r")) {
            text = "\"" + text.replace("\"", "\"\"") + "\"";
        }
        return text;
    }

    private static boolean isNumber(String text) {
        return text.matches("^-?\\d+(\\.\\d+)?$");
    }

    // ------------------------------------------------------------------ PDF

    public byte[] pdf(ReportRows report) {
        StringBuilder html = new StringBuilder("""
                <!DOCTYPE html><html><head><meta charset="UTF-8"/><style>
                @page { size: A4 landscape; margin: 14mm 12mm; }
                body { font-family: 'Inter'; font-size: 8.5pt; color: #1f2937; }
                h1 { font-size: 15pt; margin: 0 0 2mm 0; }
                p.meta { color: #6b7280; margin: 0 0 4mm 0; }
                table { width: 100%; border-collapse: collapse; -fs-table-paginate: paginate; }
                th { text-align: left; background: #f3f4f6; border-bottom: 1px solid #9ca3af; padding: 1.5mm; }
                td { border-bottom: 1px solid #e5e7eb; padding: 1.2mm 1.5mm; vertical-align: top; }
                td.num, th.num { text-align: right; }
                tr.total td { font-weight: 700; border-top: 1px solid #6b7280; background: #f9fafb; }
                </style></head><body>""");
        html.append("<h1>").append(xml(report.title())).append(" report</h1>");
        html.append("<p class=\"meta\">").append(PDF_DATE.format(report.range().from())).append(" to ")
                .append(PDF_DATE.format(report.range().to())).append(" (India time) · ").append(report.rows().size())
                .append(report.rows().size() == 1 ? " row" : " rows").append(" · generated ")
                .append(PDF_TIME.format(clock.instant())).append("</p>");
        html.append("<table><thead><tr>");
        for (Column column : report.columns()) {
            html.append("<th").append(numeric(column) ? " class=\"num\"" : "").append('>').append(xml(column.label()))
                    .append("</th>");
        }
        html.append("</tr></thead><tbody>");
        for (Map<String, Object> row : report.rows()) {
            html.append("<tr>");
            for (Column column : report.columns()) {
                cell(html, column, row.get(column.key()));
            }
            html.append("</tr>");
        }
        if (!report.totals().isEmpty()) {
            html.append("<tr class=\"total\">");
            for (Column column : report.columns()) {
                if (column == report.columns().getFirst()) {
                    html.append("<td>Total</td>");
                } else {
                    cell(html, column, report.totals().get(column.key()));
                }
            }
            html.append("</tr>");
        }
        html.append("</tbody></table></body></html>");

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFont(() -> font("Inter-Regular.ttf"), FONT, 400, FontStyle.NORMAL, true);
            builder.useFont(() -> font("Inter-Bold.ttf"), FONT, 700, FontStyle.NORMAL, true);
            builder.withHtmlContent(html.toString(), null);
            builder.withProducer("FlightHotel reports");
            builder.toStream(out);
            builder.run();
        } catch (IOException ex) {
            throw new UncheckedIOException("Could not render the " + report.report() + " report", ex);
        }
        return out.toByteArray();
    }

    private static void cell(StringBuilder html, Column column, Object value) {
        html.append("<td").append(numeric(column) ? " class=\"num\"" : "").append('>');
        if (value != null) {
            html.append(xml(switch (column.type()) {
                case MONEY -> money((BigDecimal) value);
                case DATETIME -> PDF_TIME.format((Instant) value);
                case DATE -> PDF_DATE.format((LocalDate) value);
                default -> value.toString();
            }));
        }
        html.append("</td>");
    }

    private static boolean numeric(Column column) {
        return column.type() == Type.MONEY || column.type() == Type.NUMBER;
    }

    private static String money(BigDecimal amount) {
        NumberFormat number = NumberFormat.getNumberInstance(Locale.of("en", "IN"));
        number.setMinimumFractionDigits(2);
        number.setMaximumFractionDigits(2);
        // The JDK groups en-IN like en-US (200,000.00); Indian grouping is added here.
        number.setGroupingUsed(false);
        return "₹" + IndianDigits.group(number.format(amount));
    }

    private static String xml(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static InputStream font(String file) {
        InputStream stream = ReportExporter.class.getResourceAsStream("/fonts/" + file);
        if (stream == null) {
            throw new IllegalStateException("Font missing from the classpath: " + file);
        }
        return stream;
    }
}
