package com.flighthotel.reporting.export;

import java.io.BufferedWriter;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import com.flighthotel.reporting.export.AuditExportColumns.Column;
import com.flighthotel.reporting.export.AuditExportColumns.Kind;

/**
 * Writes one .xlsx workbook row by row, straight into its zip, so a million rows never sit in memory. The layout is
 * the web export's ({@code frontend/src/lib/export/xlsx.ts}): a data sheet with a bold header row on a dark band,
 * frozen, with filter buttons, real dates with a format, fixed column widths, A4 landscape with the header repeated
 * when printed; and an "About this export" sheet. Strings are inline, so no cell can ever be a formula.
 * <p>
 * The sheet XML is written as rows arrive; the parts that need the row count (the filter range, the workbook's defined
 * names) are written after the rows, which a zip allows.
 */
final class StreamingXlsxWriter {

    /** The "About this export" sheet. {@code filters}: label and value pairs. */
    record About(String title, String subtitle, String exportedAt, String exportedBy, String scope,
            List<String[]> filters) {
    }

    static final String CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    /** Excel's limit for the text of one cell. */
    static final int MAX_CELL_TEXT = 32_767;

    private static final String NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static final String REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static final String XML_HEAD = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>";
    private static final String ABOUT_SHEET = "About this export";

    // Style indexes of cellXfs in styles.xml (the web export's STYLE).
    private static final int STYLE_HEADER = 1;
    private static final int STYLE_INTEGER = 2;
    private static final int STYLE_DATETIME = 6;
    private static final int STYLE_TITLE = 8;
    private static final int STYLE_LABEL = 10;
    private static final int STYLE_WRAP = 11;

    private static final long EXCEL_EPOCH_DAY = LocalDate.of(1899, 12, 30).toEpochDay();

    private final ZipOutputStream zip;
    private final Writer sheet;
    private final List<Column> columns;
    private final String[] letters;
    private final String sheetName;
    private int lastRow = 1;

    /** Starts the workbook and its header row. {@code out} is not closed by {@link #finish}. */
    StreamingXlsxWriter(OutputStream out, String sheetName, List<Column> columns, Instant createdAt, String title)
            throws IOException {
        this.zip = new ZipOutputStream(new NonClosing(out), StandardCharsets.UTF_8);
        // Speed over a few percent of size: millions of rows are compressed here.
        this.zip.setLevel(Deflater.BEST_SPEED);
        this.columns = List.copyOf(columns);
        this.sheetName = sheetName;
        this.letters = new String[columns.size()];
        for (int i = 0; i < letters.length; i++) {
            letters[i] = columnName(i);
        }
        entry("[Content_Types].xml", contentTypes());
        entry("_rels/.rels", rootRelationships());
        entry("docProps/core.xml", coreProperties(title, createdAt));
        entry("docProps/app.xml", XML_HEAD + "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/"
                + "2006/extended-properties\"><Application>FlightHotel</Application></Properties>");
        entry("xl/styles.xml", STYLES);

        zip.putNextEntry(new ZipEntry("xl/worksheets/sheet1.xml"));
        this.sheet = new BufferedWriter(new OutputStreamWriter(new NonClosing(zip), StandardCharsets.UTF_8), 1 << 16);
        sheet.write(XML_HEAD + "<worksheet xmlns=\"" + NS + "\" xmlns:r=\"" + REL_NS + "\">"
                + "<sheetPr><pageSetUpPr fitToPage=\"1\"/></sheetPr>"
                + "<sheetViews><sheetView workbookViewId=\"0\" tabSelected=\"1\">"
                + "<pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/>"
                + "<selection pane=\"bottomLeft\" activeCell=\"A2\" sqref=\"A2\"/></sheetView></sheetViews>"
                + "<sheetFormatPr defaultRowHeight=\"15\"/><cols>");
        for (int i = 0; i < columns.size(); i++) {
            sheet.write("<col min=\"" + (i + 1) + "\" max=\"" + (i + 1) + "\" width=\"" + columns.get(i).width()
                    + "\" customWidth=\"1\"/>");
        }
        sheet.write("</cols><sheetData><row r=\"1\" ht=\"22\" customHeight=\"1\">");
        for (int i = 0; i < columns.size(); i++) {
            textCell(sheet, letters[i] + "1", columns.get(i).header(), STYLE_HEADER);
        }
        sheet.write("</row>");
    }

    /** The data rows written so far. */
    int rows() {
        return lastRow - 1;
    }

    /** One data row: {@link Instant} for a date-time column, text (or null) otherwise. */
    void row(List<Object> values) throws IOException {
        lastRow++;
        String r = Integer.toString(lastRow);
        sheet.write("<row r=\"");
        sheet.write(r);
        sheet.write("\">");
        for (int i = 0; i < values.size(); i++) {
            Object value = values.get(i);
            if (value == null) {
                continue;
            }
            if (columns.get(i).kind() == Kind.DATETIME && value instanceof Instant instant) {
                sheet.write("<c r=\"");
                sheet.write(letters[i]);
                sheet.write(r);
                sheet.write("\" s=\"" + STYLE_DATETIME + "\"><v>");
                sheet.write(excelSerial(ExportTime.india(instant)));
                sheet.write("</v></c>");
            } else {
                String text = value.toString();
                if (!text.isEmpty()) {
                    textCell(sheet, letters[i] + r, text, text.indexOf('\n') >= 0 ? STYLE_WRAP : 0);
                }
            }
        }
        sheet.write("</row>");
    }

    /** Ends the data sheet, then writes the about sheet and the workbook; the zip is finished, {@code out} stays open. */
    void finish(About about) throws IOException {
        String lastColumn = letters[letters.length - 1];
        sheet.write("</sheetData><autoFilter ref=\"A1:" + lastColumn + lastRow + "\"/>"
                + "<pageMargins left=\"0.4\" right=\"0.4\" top=\"0.6\" bottom=\"0.6\" header=\"0.3\" footer=\"0.3\"/>"
                + "<pageSetup paperSize=\"9\" orientation=\"landscape\" fitToWidth=\"1\" fitToHeight=\"0\"/>"
                + "</worksheet>");
        sheet.flush();
        zip.closeEntry();

        entry("xl/worksheets/sheet2.xml", aboutSheet(about, rows()));
        String quoted = escape("'" + sheetName.replace("'", "''") + "'");
        entry("xl/workbook.xml", XML_HEAD + "<workbook xmlns=\"" + NS + "\" xmlns:r=\"" + REL_NS + "\">"
                + "<bookViews><workbookView activeTab=\"0\"/></bookViews>"
                + "<sheets><sheet name=\"" + escape(sheetName) + "\" sheetId=\"1\" r:id=\"rId1\"/>"
                + "<sheet name=\"" + ABOUT_SHEET + "\" sheetId=\"2\" r:id=\"rId2\"/></sheets>"
                + "<definedNames>"
                + "<definedName name=\"_xlnm._FilterDatabase\" localSheetId=\"0\" hidden=\"1\">" + quoted
                + "!$A$1:$" + lastColumn + "$" + lastRow + "</definedName>"
                + "<definedName name=\"_xlnm.Print_Titles\" localSheetId=\"0\">" + quoted + "!$1:$1</definedName>"
                + "</definedNames></workbook>");
        entry("xl/_rels/workbook.xml.rels", XML_HEAD
                + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + relationship("rId1", "officeDocument/2006/relationships/worksheet", "worksheets/sheet1.xml")
                + relationship("rId2", "officeDocument/2006/relationships/worksheet", "worksheets/sheet2.xml")
                + relationship("rId3", "officeDocument/2006/relationships/styles", "styles.xml")
                + "</Relationships>");
        zip.finish();
    }

    // ------------------------------------------------------------------ helpers

    private void entry(String name, String content) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(content.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    /** 0 → A, 25 → Z, 26 → AA. */
    static String columnName(int index) {
        StringBuilder name = new StringBuilder();
        int n = index + 1;
        while (n > 0) {
            int rest = (n - 1) % 26;
            name.insert(0, (char) ('A' + rest));
            n = (n - 1) / 26;
        }
        return name.toString();
    }

    /** Excel's serial date of a local time to the minute (as the web export): days since 30 Dec 1899 plus a fraction. */
    static String excelSerial(LocalDateTime time) {
        long days = time.toLocalDate().toEpochDay() - EXCEL_EPOCH_DAY;
        int minutes = time.getHour() * 60 + time.getMinute();
        return minutes == 0 ? Long.toString(days) : Double.toString(days + minutes / 1440.0);
    }

    private static void textCell(Writer out, String ref, String text, int style) throws IOException {
        String value = text.length() > MAX_CELL_TEXT ? text.substring(0, MAX_CELL_TEXT) : text;
        out.write("<c r=\"");
        out.write(ref);
        out.write(style == 0 ? "\" t=\"inlineStr\"><is><t" : "\" t=\"inlineStr\" s=\"" + style + "\"><is><t");
        if (!value.isEmpty() && (Character.isWhitespace(value.charAt(0))
                || Character.isWhitespace(value.charAt(value.length() - 1)) || value.indexOf('\n') >= 0)) {
            out.write(" xml:space=\"preserve\"");
        }
        out.write('>');
        escape(out, value);
        out.write("</t></is></c>");
    }

    static String escape(String text) {
        StringBuilder out = new StringBuilder(text.length() + 16);
        for (int i = 0; i < text.length(); i++) {
            append(out, text.charAt(i));
        }
        return out.toString();
    }

    private static void escape(Writer out, String text) throws IOException {
        int start = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            String replacement = switch (c) {
                case '&' -> "&amp;";
                case '<' -> "&lt;";
                case '>' -> "&gt;";
                case '"' -> "&quot;";
                default -> validXml(c) ? null : "";
            };
            if (replacement != null) {
                out.write(text, start, i - start);
                out.write(replacement);
                start = i + 1;
            }
        }
        out.write(text, start, text.length() - start);
    }

    private static void append(StringBuilder out, char c) {
        switch (c) {
            case '&' -> out.append("&amp;");
            case '<' -> out.append("&lt;");
            case '>' -> out.append("&gt;");
            case '"' -> out.append("&quot;");
            default -> {
                if (validXml(c)) {
                    out.append(c);
                }
            }
        }
    }

    /** XML 1.0 has no place for most control characters (and U+FFFE, U+FFFF): they are dropped. */
    private static boolean validXml(char c) {
        return c >= 0x20 ? c != '￾' && c != '￿' : c == '\t' || c == '\n' || c == '\r';
    }

    private static String aboutSheet(About about, int rowCount) throws IOException {
        StringBuilder rows = new StringBuilder();
        int[] r = {1};
        java.util.function.Consumer<String> add = cells -> {
            rows.append("<row r=\"").append(r[0]).append("\">").append(cells).append("</row>");
            r[0]++;
        };
        add.accept(cell("A" + r[0], about.title(), STYLE_TITLE));
        if (about.subtitle() != null) {
            add.accept(cell("A" + r[0], about.subtitle(), 0));
        }
        r[0]++;
        add.accept(cell("A" + r[0], "Exported", STYLE_LABEL) + cell("B" + r[0], about.exportedAt(), 0));
        if (about.exportedBy() != null) {
            add.accept(cell("A" + r[0], "Exported by", STYLE_LABEL) + cell("B" + r[0], about.exportedBy(), 0));
        }
        add.accept(cell("A" + r[0], "Rows", STYLE_LABEL) + "<c r=\"B" + r[0] + "\" s=\"" + STYLE_INTEGER + "\"><v>"
                + rowCount + "</v></c>");
        if (about.scope() != null) {
            add.accept(cell("A" + r[0], "Rows included", STYLE_LABEL) + cell("B" + r[0], about.scope(), 0));
        }
        r[0]++;
        add.accept(cell("A" + r[0], "Filters and sorting", STYLE_LABEL)
                + cell("B" + r[0], about.filters().isEmpty() ? "None: every entry" : "", 0));
        for (String[] filter : about.filters()) {
            add.accept(cell("A" + r[0], filter[0], 0) + cell("B" + r[0], filter[1], 0));
        }
        return XML_HEAD + "<worksheet xmlns=\"" + NS + "\" xmlns:r=\"" + REL_NS + "\">"
                + "<sheetViews><sheetView workbookViewId=\"0\"/></sheetViews>"
                + "<sheetFormatPr defaultRowHeight=\"15\"/>"
                + "<cols><col min=\"1\" max=\"1\" width=\"22\" customWidth=\"1\"/>"
                + "<col min=\"2\" max=\"2\" width=\"70\" customWidth=\"1\"/></cols>"
                + "<sheetData>" + rows + "</sheetData>"
                + "<pageMargins left=\"0.5\" right=\"0.5\" top=\"0.75\" bottom=\"0.75\" header=\"0.3\" footer=\"0.3\"/>"
                + "</worksheet>";
    }

    private static String cell(String ref, String text, int style) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        try {
            java.io.StringWriter out = new java.io.StringWriter();
            textCell(out, ref, text, style);
            return out.toString();
        } catch (IOException ex) {
            throw new java.io.UncheckedIOException(ex);
        }
    }

    private static String relationship(String id, String type, String target) {
        return "<Relationship Id=\"" + id + "\" Type=\"http://schemas.openxmlformats.org/" + type + "\" Target=\""
                + target + "\"/>";
    }

    private static String contentTypes() {
        String sheet = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
        return XML_HEAD + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument."
                + "spreadsheetml.sheet.main+xml\"/>"
                + "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"" + sheet + "\"/>"
                + "<Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"" + sheet + "\"/>"
                + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument."
                + "spreadsheetml.styles+xml\"/>"
                + "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package."
                + "core-properties+xml\"/>"
                + "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument."
                + "extended-properties+xml\"/>"
                + "</Types>";
    }

    private static String rootRelationships() {
        return XML_HEAD + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + relationship("rId1", "officeDocument/2006/relationships/officeDocument", "xl/workbook.xml")
                + relationship("rId2", "package/2006/relationships/metadata/core-properties", "docProps/core.xml")
                + relationship("rId3", "officeDocument/2006/relationships/extended-properties", "docProps/app.xml")
                + "</Relationships>";
    }

    private static String coreProperties(String title, Instant createdAt) {
        return XML_HEAD + "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/"
                + "core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" "
                + "xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">"
                + "<dc:title>" + escape(title) + "</dc:title><dc:creator>FlightHotel</dc:creator>"
                + "<dcterms:created xsi:type=\"dcterms:W3CDTF\">" + createdAt.truncatedTo(ChronoUnit.SECONDS)
                + "</dcterms:created></cp:coreProperties>";
    }

    /** The web export's styles.xml, unchanged (style indexes above refer to its cellXfs). */
    private static final String STYLES = XML_HEAD + "<styleSheet xmlns=\"" + NS + "\">"
            + "<numFmts count=\"4\">"
            + "<numFmt numFmtId=\"164\" formatCode=\"&quot;₹&quot;#,##0.00\"/>"
            + "<numFmt numFmtId=\"165\" formatCode=\"dd mmm yyyy\"/>"
            + "<numFmt numFmtId=\"166\" formatCode=\"dd mmm yyyy hh:mm\"/>"
            + "<numFmt numFmtId=\"167\" formatCode=\"0.0%\"/>"
            + "</numFmts>"
            + "<fonts count=\"5\">"
            + "<font><sz val=\"11\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/><scheme val=\"minor\"/></font>"
            + "<font><b/><sz val=\"11\"/><color rgb=\"FFFFFFFF\"/><name val=\"Calibri\"/><family val=\"2\"/>"
            + "<scheme val=\"minor\"/></font>"
            + "<font><b/><sz val=\"14\"/><color rgb=\"FF0F172A\"/><name val=\"Calibri\"/><family val=\"2\"/>"
            + "<scheme val=\"minor\"/></font>"
            + "<font><b/><sz val=\"11\"/><color rgb=\"FF334155\"/><name val=\"Calibri\"/><family val=\"2\"/>"
            + "<scheme val=\"minor\"/></font>"
            + "<font><b/><sz val=\"11\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/>"
            + "<scheme val=\"minor\"/></font>"
            + "</fonts>"
            + "<fills count=\"3\">"
            + "<fill><patternFill patternType=\"none\"/></fill>"
            + "<fill><patternFill patternType=\"gray125\"/></fill>"
            + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF1E293B\"/><bgColor indexed=\"64\"/></patternFill></fill>"
            + "</fills>"
            + "<borders count=\"2\"><border><left/><right/><top/><bottom/><diagonal/></border>"
            + "<border><left/><right/><top style=\"thin\"><color rgb=\"FF94A3B8\"/></top><bottom/><diagonal/></border></borders>"
            + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
            + "<cellXfs count=\"19\">"
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"
            + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" "
            + "applyAlignment=\"1\"><alignment vertical=\"center\"/></xf>"
            + "<xf numFmtId=\"3\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>"
            + "<xf numFmtId=\"4\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>"
            + "<xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>"
            + "<xf numFmtId=\"165\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" "
            + "applyAlignment=\"1\"><alignment horizontal=\"left\"/></xf>"
            + "<xf numFmtId=\"166\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" "
            + "applyAlignment=\"1\"><alignment horizontal=\"left\"/></xf>"
            + "<xf numFmtId=\"167\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" "
            + "applyAlignment=\"1\"><alignment horizontal=\"right\" vertical=\"center\"/></xf>"
            + "<xf numFmtId=\"0\" fontId=\"3\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>"
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyAlignment=\"1\">"
            + "<alignment vertical=\"top\" wrapText=\"1\"/></xf>"
            + "<xf numFmtId=\"0\" fontId=\"4\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\"/>"
            + "<xf numFmtId=\"3\" fontId=\"4\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" "
            + "applyFont=\"1\" applyBorder=\"1\"/>"
            + "<xf numFmtId=\"4\" fontId=\"4\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" "
            + "applyFont=\"1\" applyBorder=\"1\"/>"
            + "<xf numFmtId=\"164\" fontId=\"4\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" "
            + "applyFont=\"1\" applyBorder=\"1\"/>"
            + "<xf numFmtId=\"165\" fontId=\"4\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" "
            + "applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\"/></xf>"
            + "<xf numFmtId=\"166\" fontId=\"4\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" "
            + "applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\"/></xf>"
            + "<xf numFmtId=\"167\" fontId=\"4\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" "
            + "applyFont=\"1\" applyBorder=\"1\"/>"
            + "</cellXfs>"
            + "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>"
            + "</styleSheet>";

    /** Closing it only flushes: the zip (or the file) below stays open for what follows. */
    static final class NonClosing extends FilterOutputStream {

        NonClosing(OutputStream out) {
            super(out);
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
            out.write(b, off, len);
        }

        @Override
        public void close() throws IOException {
            out.flush();
        }
    }
}
