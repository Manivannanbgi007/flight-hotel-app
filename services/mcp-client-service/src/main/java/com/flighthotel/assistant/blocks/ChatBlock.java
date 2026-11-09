package com.flighthotel.assistant.blocks;

import java.util.List;

/**
 * One card of an answer, built by the server from the tool results (never by the language model), so every value on it
 * is exactly what the backend returned. The browser renders it with its own components: it holds data only, no HTML, no
 * URLs and nothing to execute.
 *
 * @param type    BOOKINGS, PAYMENTS, NOTIFICATIONS, TICKETS, RESERVATIONS, HOTELS, FLIGHTS, OFFERS, REFUNDS or RECORDS
 *                (lists of {@link Item}); DETAILS (one record in sections); METRICS (figures); TABLE (a report);
 *                STEPS (how to do something); NOTICE (a message; tone info, warning or error)
 * @param title   "Your trips"
 * @param summary one line, e.g. "3 of 12 shown" or "7 Oct to 5 Nov 2026"
 * @param total   how many records the backend says match (null when not applicable)
 * @param empty   set when nothing matched: "No matching bookings were found."
 * @param tone    for NOTICE: info, warning or error; for DETAILS: the tone of {@code summary}'s status
 */
public record ChatBlock(String type, String title, String summary, Integer total, String empty, String tone,
        List<Item> items, List<Metric> metrics, List<Section> sections, List<String> steps, List<String> columns,
        List<List<String>> rows) {

    public ChatBlock {
        items = items == null ? List.of() : List.copyOf(items);
        metrics = metrics == null ? List.of() : List.copyOf(metrics);
        sections = sections == null ? List.of() : List.copyOf(sections);
        steps = steps == null ? List.of() : List.copyOf(steps);
        columns = columns == null ? List.of() : List.copyOf(columns);
        rows = rows == null ? List.of() : List.copyOf(rows);
    }

    /** A record in a list: a booking, a payment, a ticket. {@code tone}: success, warning, danger, info or neutral. */
    public record Item(String title, String subtitle, String badge, String tone, List<Field> fields) {

        public Item {
            fields = fields == null ? List.of() : List.copyOf(fields);
        }
    }

    /** {@code kind}: text, date (ISO date), datetime (ISO instant) or money, so the browser can format it. */
    public record Field(String label, String value, String kind) {
    }

    public record Metric(String label, String value, String hint, String kind) {
    }

    public record Section(String title, List<Field> fields) {

        public Section {
            fields = fields == null ? List.of() : List.copyOf(fields);
        }
    }

    public static ChatBlock list(String type, String title, String summary, Integer total, String empty,
            List<Item> items) {
        return new ChatBlock(type, title, summary, total, empty, null, items, null, null, null, null, null);
    }

    public static ChatBlock metrics(String title, String summary, List<Metric> metrics) {
        return new ChatBlock("METRICS", title, summary, null, null, null, null, metrics, null, null, null, null);
    }

    public static ChatBlock details(String title, String summary, String tone, List<Section> sections) {
        return new ChatBlock("DETAILS", title, summary, null, null, tone, null, null, sections, null, null, null);
    }

    public static ChatBlock table(String title, String summary, Integer total, List<String> columns,
            List<List<String>> rows, List<Metric> totals) {
        return new ChatBlock("TABLE", title, summary, total, null, null, null, totals, null, null, columns, rows);
    }

    public static ChatBlock steps(String title, List<String> steps) {
        return new ChatBlock("STEPS", title, null, null, null, null, null, null, null, steps, null, null);
    }

    public static ChatBlock notice(String tone, String title, String message) {
        return new ChatBlock("NOTICE", title, message, null, null, tone, null, null, null, null, null, null);
    }
}
