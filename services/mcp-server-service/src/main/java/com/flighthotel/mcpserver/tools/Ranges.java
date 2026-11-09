package com.flighthotel.mcpserver.tools;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The date-range parameters of dashboards and reports (API_DOCUMENTATION.md §14.0, Phase 11 analytics §0.2). */
final class Ranges {

    /** Reports and hotel reports: at most 366 days. */
    static final List<String> REPORT_PRESETS = List.of("TODAY", "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS",
            "LAST_90_DAYS", "THIS_MONTH", "PREVIOUS_MONTH", "THIS_YEAR", "PREVIOUS_YEAR", "LAST_12_MONTHS", "CUSTOM");
    /** Dashboards and metrics: up to five years. */
    static final List<String> DASHBOARD_PRESETS = List.of("TODAY", "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS",
            "LAST_90_DAYS", "THIS_MONTH", "PREVIOUS_MONTH", "THIS_YEAR", "PREVIOUS_YEAR", "LAST_12_MONTHS",
            "LAST_3_YEARS", "LAST_5_YEARS", "CUSTOM");
    static final int REPORT_MAX_DAYS = 366;
    static final int DASHBOARD_MAX_DAYS = 1827;

    private Ranges() {
    }

    static Param range() {
        return range(REPORT_PRESETS);
    }

    static Param range(List<String> presets) {
        return Param.oneOf("range", "Period (default LAST_30_DAYS). LAST_7_DAYS = today and the 6 days before. "
                + "CUSTOM needs from and to.", presets);
    }

    static Param from(String description) {
        return Param.date("from", description);
    }

    static Param to(String description) {
        return Param.date("to", description);
    }

    /** {@code range}, {@code from}, {@code to} as query parameters for a report (at most 366 days). */
    static Map<String, Object> query(Args args) {
        return query(args, REPORT_MAX_DAYS);
    }

    /** {@code range}, {@code from}, {@code to} as query parameters, checked like the services check them. */
    static Map<String, Object> query(Args args, int maxDays) {
        String range = args.text("range");
        LocalDate from = args.date("from");
        LocalDate to = args.date("to");
        if (range == null && (from != null || to != null)) {
            range = "CUSTOM";
        }
        Map<String, Object> query = new LinkedHashMap<>();
        if (range == null) {
            return query;
        }
        query.put("range", range);
        if ("CUSTOM".equals(range)) {
            checkDates(from, to, true, maxDays);
            query.put("from", from);
            query.put("to", to);
        }
        return query;
    }

    /** Optional {@code from}/{@code to} filters (creation dates). */
    static void checkDates(LocalDate from, LocalDate to, boolean required) {
        checkDates(from, to, required, REPORT_MAX_DAYS);
    }

    static void checkDates(LocalDate from, LocalDate to, boolean required, int maxDays) {
        if (required && (from == null || to == null)) {
            throw new ToolInputException(from == null ? "from" : "to", "is required for a CUSTOM range");
        }
        if (from != null && to != null) {
            if (to.isBefore(from)) {
                throw new ToolInputException("to", "must not be before from");
            }
            if (from.plusDays(maxDays).isBefore(to)) {
                throw new ToolInputException("to", "must be at most " + maxDays + " days after from");
            }
        }
    }

    /** A Phase 11 {@code Change} object ({@code current, previous, change, changePercent, trend}) in short form. */
    static Map<String, Object> change(tools.jackson.databind.JsonNode change, boolean money) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (change == null || !change.isObject()) {
            return out;
        }
        if (money) {
            Out.money(out, "previous", change, "previous", "INR");
        } else {
            Out.put(out, "previous", Out.scalar(change.get("previous")));
        }
        Out.put(out, "changePercent", Out.scalar(change.get("changePercent")));
        Out.put(out, "trend", Out.text(change, "trend"));
        return out;
    }
}
