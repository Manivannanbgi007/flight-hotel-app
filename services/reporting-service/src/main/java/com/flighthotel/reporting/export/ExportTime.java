package com.flighthotel.reporting.export;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

import com.flighthotel.reporting.report.ReportRange;

/** Times in export files are India times, written as the web export writes them. */
final class ExportTime {

    private static final DateTimeFormatter SHOWN = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.ENGLISH);
    private static final DateTimeFormatter SHOWN_DATE = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter PLAIN = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private static final DateTimeFormatter FILE_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    private ExportTime() {
    }

    static LocalDateTime india(Instant instant) {
        return LocalDateTime.ofInstant(instant, ReportRange.INDIA);
    }

    /** "9 Nov 2026, 14:05". */
    static String shown(Instant instant) {
        return SHOWN.format(india(instant));
    }

    /** "9 Nov 2026". */
    static String shownDate(Instant instant) {
        return SHOWN_DATE.format(india(instant));
    }

    /** "2026-11-09 14:05": what a CSV holds, so any program reads it as a date and time. */
    static String plain(Instant instant) {
        return PLAIN.format(india(instant));
    }

    /** "2026-11-09", for file names. */
    static String fileDate(Instant instant) {
        return FILE_DATE.format(india(instant));
    }
}
