package com.flighthotel.assistant.blocks;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import com.flighthotel.assistant.blocks.ChatBlock.Field;
import com.flighthotel.assistant.blocks.ChatBlock.Item;
import com.flighthotel.assistant.blocks.ChatBlock.Metric;
import com.flighthotel.assistant.blocks.ChatBlock.Section;

/**
 * Turns what a tool returned into cards. Nothing here asks the language model: a card shows the tool's own values, so an
 * amount, status, reference or date on it is exactly what the backend said. A missing value is left out (never filled
 * in), a zero is shown as 0, and an empty result becomes an explicit "no matching records" card.
 *
 * <p>The tool results are the compact JSON the MCP server writes for the model (amounts already formatted, no internal
 * ids); they are read here as plain maps and lists.
 */
public final class BlockBuilder {

    private static final int MAX_METRICS = 12;
    private static final int MAX_FIELDS = 8;
    private static final Pattern ISO_DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final Pattern ISO_DATE_TIME = Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}.*");
    private static final Pattern MONEY = Pattern.compile("^(₹|Rs\\.? ?|INR ?)[\\d,]+(\\.\\d+)?$");

    /** How a list-shaped tool result becomes cards. */
    private record ListSpec(String key, String type, String title, String noun, List<String> titleKeys,
            List<String> subtitleKeys, String badgeKey, List<String> fieldKeys) {
    }

    private static final ListSpec BOOKINGS = new ListSpec("bookings", "BOOKINGS", "Your trips", "bookings",
            List.of("title", "reference"), List.of("destination"), "status",
            List.of("reference", "type", "startDate", "endDate", "paymentStatus", "total", "needsAttention", "leadName",
                    "contactEmail", "createdAt"));
    private static final ListSpec PAYMENTS = new ListSpec("payments", "PAYMENTS", "Payments", "payments",
            List.of("description", "bookingReference"), List.of("bookingReference"), "status",
            List.of("amount", "refunded", "method", "createdAt", "invoiceNumber", "failure", "provider"));
    private static final ListSpec REFUNDS = new ListSpec("refunds", "REFUNDS", "Refunds", "refunds",
            List.of("bookingReference"), List.of("reason"), "status",
            List.of("amount", "createdAt", "updatedAt", "failure"));
    private static final ListSpec TICKETS = new ListSpec("tickets", "TICKETS", "Support tickets", "support tickets",
            List.of("subject", "ticketNumber"), List.of("ticketNumber"), "status",
            List.of("category", "priority", "bookingReference", "createdAt", "lastMessageAt"));
    private static final ListSpec NOTIFICATIONS = new ListSpec("notifications", "NOTIFICATIONS", "Notifications",
            "notifications", List.of("title"), List.of("message"), null, List.of("category", "createdAt"));
    private static final ListSpec RESERVATIONS = new ListSpec("reservations", "RESERVATIONS", "Reservations",
            "reservations", List.of("leadGuest", "bookingReference"), List.of("roomTypeName"), "status",
            List.of("bookingReference", "checkIn", "checkOut", "nights", "rooms", "adults", "children", "total",
                    "confirmationNumber"));
    private static final ListSpec HOTELS = new ListSpec("hotels", "HOTELS", "Hotels", "hotels", List.of("name"),
            List.of("city"), null, List.of("starRating", "guestRating", "pricePerNight", "totalPrice",
                    "cheapestRoomType", "freeCancellation", "breakfastIncluded", "available"));
    private static final ListSpec OFFERS = new ListSpec("offers", "OFFERS", "Current offers", "offers", List.of("title"),
            List.of("discountLabel"), null, List.of("couponCode", "appliesTo", "destinationCity", "validTo"));
    private static final ListSpec MY_HOTELS = new ListSpec("hotels", "RECORDS", "Your hotels", "hotels",
            List.of("name"), List.of("city"), "status", List.of("starRating"));
    private static final ListSpec FLIGHTS = new ListSpec("flights", "FLIGHTS", "Flights", "flights",
            List.of("airline", "flightNumber"), List.of("flightNumber"), null,
            List.of("departureLocal", "arrivalLocal", "durationMinutes", "stops", "viaAirport", "fare", "refundable",
                    "seatsLeft", "totalPrice"));

    private static final Map<String, ListSpec> LISTS = Map.ofEntries(
            Map.entry("my_bookings", BOOKINGS),
            Map.entry("find_bookings", withTitle(BOOKINGS, "Bookings")),
            Map.entry("search_bookings", withTitle(BOOKINGS, "Bookings")),
            Map.entry("my_payments", withTitle(PAYMENTS, "Your payments")),
            Map.entry("search_payments", PAYMENTS),
            Map.entry("search_refunds", REFUNDS),
            Map.entry("my_support_tickets", withTitle(TICKETS, "Your support tickets")),
            Map.entry("ticket_queue", withTitle(TICKETS, "Ticket queue")),
            Map.entry("my_notifications", NOTIFICATIONS),
            Map.entry("hotel_reservations", RESERVATIONS),
            Map.entry("search_hotels", HOTELS),
            Map.entry("current_offers", OFFERS),
            Map.entry("my_hotels", MY_HOTELS));

    private static final Set<String> METRIC_TOOLS = Set.of("admin_dashboard", "hotel_dashboard", "hotel_occupancy",
            "my_trip_summary", "ticket_summary", "ticket_metrics");
    private static final Set<String> DETAIL_TOOLS = Set.of("booking_details", "cancellation_quote", "hotel_details");

    private static final Map<String, String> TITLES = Map.of(
            "admin_dashboard", "Admin dashboard",
            "hotel_dashboard", "Hotel dashboard",
            "hotel_occupancy", "Occupancy and revenue",
            "my_trip_summary", "Your travel summary",
            "ticket_summary", "Ticket summary",
            "ticket_metrics", "Support metrics",
            "booking_details", "Booking details",
            "cancellation_quote", "Cancellation quote",
            "hotel_details", "Hotel details");

    private static final Map<String, String> LABELS = Map.ofEntries(
            Map.entry("reference", "Reference"), Map.entry("startDate", "From"), Map.entry("endDate", "To"),
            Map.entry("total", "Total"), Map.entry("paymentStatus", "Payment"),
            Map.entry("bookingReference", "Booking"), Map.entry("createdAt", "Date"),
            Map.entry("lastMessageAt", "Last activity"), Map.entry("checkIn", "Check-in"),
            Map.entry("checkOut", "Check-out"), Map.entry("roomTypeName", "Room"),
            Map.entry("needsAttention", "Needs attention"), Map.entry("leadName", "Guest"),
            Map.entry("contactEmail", "Contact"), Map.entry("revPar", "RevPAR"),
            Map.entry("averageDailyRate", "Average daily rate"), Map.entry("pnr", "PNR"),
            Map.entry("departureLocal", "Departs"), Map.entry("arrivalLocal", "Arrives"),
            Map.entry("durationMinutes", "Duration (min)"), Map.entry("pricePerNight", "Per night"),
            Map.entry("totalPrice", "Total price"), Map.entry("viaAirport", "Via"));

    private static final Set<String> SKIPPED_METRIC_KEYS = Set.of("definitions", "range", "bookingHint", "hint");

    private BlockBuilder() {
    }

    private static ListSpec withTitle(ListSpec spec, String title) {
        return new ListSpec(spec.key(), spec.type(), title, spec.noun(), spec.titleKeys(), spec.subtitleKeys(),
                spec.badgeKey(), spec.fieldKeys());
    }

    /**
     * The cards for one tool result.
     *
     * @param tool   the MCP tool name
     * @param result the result as maps, lists and scalars
     */
    public static List<ChatBlock> build(String tool, Map<String, Object> result) {
        if (result == null) {
            return List.of();
        }
        if (result.containsKey("error")) {
            return notice(result).map(List::of).orElse(List.of());
        }
        List<ChatBlock> blocks = new ArrayList<>();
        switch (tool) {
            case "hotel_arrivals_departures" -> arrivalsDepartures(result, blocks);
            case "search_flights" -> flights(result, blocks);
            case "run_report" -> report(result, blocks);
            default -> {
                if (LISTS.containsKey(tool)) {
                    lists(tool, LISTS.get(tool), result, blocks);
                } else if (METRIC_TOOLS.contains(tool)) {
                    metricBlocks(tool, result, blocks);
                } else if (DETAIL_TOOLS.contains(tool)) {
                    details(tool, result, blocks);
                }
            }
        }
        return blocks;
    }

    // ---------------------------------------------------------------- lists

    @SuppressWarnings("unchecked")
    private static void lists(String tool, ListSpec spec, Map<String, Object> result, List<ChatBlock> out) {
        Object perHotel = result.get("hotels");
        // Several hotels: {"hotels": [{"hotel": "Sea Breeze", "reservations": [...]}, ...]}
        if ("hotel_reservations".equals(tool) && perHotel instanceof List<?> hotels) {
            for (Object entry : hotels) {
                if (entry instanceof Map<?, ?> map) {
                    out.add(listBlock(spec, (Map<String, Object>) map, "Reservations: " + text(map.get("hotel"))));
                }
            }
            return;
        }
        ChatBlock block = listBlock(spec, result, "hotel_reservations".equals(tool) && result.get("hotel") != null
                ? "Reservations: " + text(result.get("hotel")) : spec.title());
        if ("my_notifications".equals(tool) && result.get("unread") != null) {
            block = new ChatBlock(block.type(), block.title(), text(result.get("unread")) + " unread", block.total(),
                    block.empty(), null, block.items(), null, null, null, null, null);
        }
        out.add(block);
    }

    private static ChatBlock listBlock(ListSpec spec, Map<String, Object> source, String title) {
        List<Item> items = new ArrayList<>();
        Object rows = source.get(spec.key());
        if (rows instanceof List<?> list) {
            for (Object row : list) {
                if (row instanceof Map<?, ?> map) {
                    items.add(item(spec, map));
                }
            }
        }
        Integer total = integer(source.get("count") != null ? source.get("count")
                : source.get("found") != null ? source.get("found") : source.get("rowCount"));
        String summary = items.isEmpty() ? null
                : total != null && total > items.size() ? items.size() + " of " + total + " shown"
                : items.size() + (items.size() == 1 ? " " + singular(spec.noun()) : " " + spec.noun());
        return ChatBlock.list(spec.type(), title, summary, total != null ? total : (items.isEmpty() ? 0 : items.size()),
                items.isEmpty() ? "No matching " + spec.noun() + " were found." : null, items);
    }

    private static Item item(ListSpec spec, Map<?, ?> row) {
        String title = firstText(row, spec.titleKeys());
        String subtitle = null;
        List<String> parts = new ArrayList<>();
        for (String key : spec.subtitleKeys()) {
            String value = text(row.get(key));
            if (value != null && !value.equals(title)) {
                parts.add(value);
            }
        }
        if (!parts.isEmpty()) {
            subtitle = String.join(" · ", parts);
        }
        String status = spec.badgeKey() == null ? null : text(row.get(spec.badgeKey()));
        String badge = status == null ? null : humanize(status);
        String tone = status == null ? "neutral" : tone(status);
        if ("NOTIFICATIONS".equals(spec.type()) && Boolean.FALSE.equals(row.get("read"))) {
            badge = "New";
            tone = "info";
        }
        List<Field> fields = new ArrayList<>();
        for (String key : spec.fieldKeys()) {
            Field field = field(key, row.get(key));
            if (field != null && fields.size() < MAX_FIELDS && !field.value().equals(title)) {
                fields.add(field);
            }
        }
        return new Item(title == null ? "(no title)" : title, subtitle, badge, tone, fields);
    }

    @SuppressWarnings("unchecked")
    private static void arrivalsDepartures(Map<String, Object> result, List<ChatBlock> out) {
        Object nested = result.get("hotels");
        if (nested instanceof List<?> hotels) {
            for (Object hotel : hotels) {
                if (hotel instanceof Map<?, ?> map) {
                    arrivalsDepartures((Map<String, Object>) map, out);
                }
            }
            return;
        }
        String hotel = text(result.get("hotel"));
        String date = text(result.get("date"));
        String where = (hotel == null ? "" : hotel) + (date == null ? "" : " · " + date);
        if (result.containsKey("arriving")) {
            out.add(listBlock(withKey(RESERVATIONS, "arriving"), result, "Arriving: " + where));
        }
        if (result.containsKey("leaving")) {
            out.add(listBlock(withKey(RESERVATIONS, "leaving"), result, "Leaving: " + where));
        }
    }

    private static ListSpec withKey(ListSpec spec, String key) {
        return new ListSpec(key, spec.type(), spec.title(), spec.noun(), spec.titleKeys(), spec.subtitleKeys(),
                spec.badgeKey(), spec.fieldKeys());
    }

    @SuppressWarnings("unchecked")
    private static void flights(Map<String, Object> result, List<ChatBlock> out) {
        for (String direction : List.of("outbound", "inbound")) {
            if (result.get(direction) instanceof Map<?, ?> map) {
                Map<String, Object> leg = (Map<String, Object>) map;
                String route = text(leg.get("from")) + " to " + text(leg.get("to")) + " · " + text(leg.get("date"));
                ChatBlock block = listBlock(FLIGHTS, leg, ("outbound".equals(direction) ? "Outbound: " : "Return: ") + route);
                out.add(new ChatBlock(block.type(), block.title(), block.summary(), integer(leg.get("options")),
                        block.empty(), null, block.items(), null, null, null, null, null));
            }
        }
    }

    // ------------------------------------------------------------ metrics

    @SuppressWarnings("unchecked")
    private static void metricBlocks(String tool, Map<String, Object> result, List<ChatBlock> out) {
        Object nested = result.get("hotels");
        if (nested instanceof List<?> hotels) {
            for (Object hotel : hotels) {
                if (hotel instanceof Map<?, ?> map) {
                    out.add(metricBlock(tool, (Map<String, Object>) map, text(map.get("hotel"))));
                }
            }
            return;
        }
        out.add(metricBlock(tool, result, text(result.get("hotel"))));
    }

    private static ChatBlock metricBlock(String tool, Map<String, Object> source, String hotel) {
        List<Metric> metrics = new ArrayList<>();
        flatten("", source, metrics, 0);
        String title = TITLES.getOrDefault(tool, tool) + (hotel == null ? "" : ": " + hotel);
        return ChatBlock.metrics(title, rangeText(source.get("range")), metrics);
    }

    private static void flatten(String prefix, Map<?, ?> map, List<Metric> out, int depth) {
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            String key = String.valueOf(entry.getKey());
            if (SKIPPED_METRIC_KEYS.contains(key) || "hotel".equals(key) && depth == 0 || out.size() >= MAX_METRICS) {
                continue;
            }
            Object value = entry.getValue();
            String label = prefix.isEmpty() ? humanize(key) : prefix + " · " + humanize(key).toLowerCase(Locale.ROOT);
            if (value instanceof Map<?, ?> inner && depth < 2) {
                flatten(prefix.isEmpty() ? humanize(key) : label, inner, out, depth + 1);
            } else if (value instanceof List<?> list && !list.isEmpty() && list.getFirst() instanceof Map<?, ?>) {
                // Lists of records (top destinations...) read better as one figure per entry.
                int n = 0;
                for (Object element : list) {
                    if (element instanceof Map<?, ?> row && n++ < 3 && out.size() < MAX_METRICS) {
                        out.add(new Metric(humanize(key) + " " + n, rowText(row), null, "text"));
                    }
                }
            } else if (value != null && !(value instanceof Map<?, ?>) && !(value instanceof List<?>)) {
                String shown = scalar(value);
                out.add(new Metric(label, key.toLowerCase(Locale.ROOT).contains("percent") && !shown.endsWith("%")
                        ? shown + "%" : shown, null, kind(shown)));
            }
        }
    }

    private static String rowText(Map<?, ?> row) {
        List<String> parts = new ArrayList<>();
        for (Object value : row.values()) {
            if (value != null) {
                parts.add(scalar(value));
            }
        }
        return String.join(" · ", parts);
    }

    private static String rangeText(Object range) {
        if (range instanceof Map<?, ?> map && map.get("from") != null && map.get("to") != null) {
            return map.get("from") + " to " + map.get("to");
        }
        return null;
    }

    // ------------------------------------------------------------- report

    @SuppressWarnings("unchecked")
    private static void report(Map<String, Object> result, List<ChatBlock> out) {
        List<String> columns = new ArrayList<>();
        List<List<String>> rows = new ArrayList<>();
        if (result.get("rows") instanceof List<?> list) {
            for (Object row : list) {
                if (row instanceof Map<?, ?> map) {
                    if (columns.isEmpty()) {
                        map.keySet().forEach(key -> columns.add(String.valueOf(key)));
                    }
                    List<String> cells = new ArrayList<>();
                    for (String column : columns) {
                        Object value = map.get(column);
                        cells.add(value == null ? "–" : scalar(value));
                    }
                    rows.add(cells);
                }
            }
        }
        List<Metric> totals = new ArrayList<>();
        if (result.get("totals") instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : ((Map<String, Object>) map).entrySet()) {
                if (entry.getValue() != null && totals.size() < MAX_METRICS) {
                    String shown = scalar(entry.getValue());
                    totals.add(new Metric(humanize(String.valueOf(entry.getKey())), shown, null, kind(shown)));
                }
            }
        }
        String title = text(result.get("report")) == null ? "Report" : text(result.get("report"));
        List<String> headers = columns.stream().map(BlockBuilder::humanize).toList();
        ChatBlock block = ChatBlock.table(title, rangeText(result.get("range")), integer(result.get("rowCount")), headers,
                rows, totals);
        out.add(rows.isEmpty() && totals.isEmpty()
                ? ChatBlock.list("RECORDS", title, null, 0, "No matching records were found.", List.of()) : block);
    }

    // ------------------------------------------------------------ details

    private static void details(String tool, Map<String, Object> result, List<ChatBlock> out) {
        List<Section> sections = new ArrayList<>();
        List<Field> top = new ArrayList<>();
        Map<String, Section> nested = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : result.entrySet()) {
            Object value = entry.getValue();
            if (value instanceof Map<?, ?> map) {
                List<Field> fields = new ArrayList<>();
                map.forEach((key, inner) -> addField(fields, String.valueOf(key), inner));
                if (!fields.isEmpty()) {
                    nested.put(humanize(entry.getKey()), new Section(humanize(entry.getKey()), fields));
                }
            } else {
                addField(top, entry.getKey(), value);
            }
        }
        if (!top.isEmpty()) {
            sections.add(new Section("cancellation_quote".equals(tool) ? "Quote" : "Overview", top));
        }
        sections.addAll(nested.values());
        String status = text(result.get("status"));
        String title = firstText(result, List.of("title", "name", "reference"));
        out.add(ChatBlock.details(title == null ? TITLES.get(tool) : title, status == null ? null : humanize(status),
                status == null ? "neutral" : tone(status), sections));
    }

    private static void addField(List<Field> fields, String key, Object value) {
        if (value == null || "hint".equals(key) || "howToCancel".equals(key)) {
            return;
        }
        if (value instanceof List<?> list) {
            if (list.isEmpty()) {
                return;
            }
            if (list.getFirst() instanceof Map<?, ?>) {
                int n = 0;
                for (Object element : list) {
                    if (element instanceof Map<?, ?> row) {
                        fields.add(new Field(humanize(key) + " " + ++n, rowText(row), "text"));
                    }
                }
            } else {
                // A list of plain values (amenities, flight numbers) is one joined field.
                fields.add(new Field(humanize(key), String.join(", ", list.stream().filter(java.util.Objects::nonNull)
                        .map(BlockBuilder::scalar).toList()), "text"));
            }
            return;
        }
        if (value instanceof Map<?, ?> map) {
            fields.add(new Field(humanize(key), rowText(map), "text"));
            return;
        }
        Field field = field(key, value);
        if (field != null) {
            fields.add(field);
        }
    }

    // ------------------------------------------------------------- notice

    private static java.util.Optional<ChatBlock> notice(Map<String, Object> result) {
        String code = text(result.get("error"));
        String message = text(result.get("message"));
        if (code == null || "TOO_MANY_LOOKUPS".equals(code)) {
            return java.util.Optional.empty();
        }
        return java.util.Optional.of(switch (code) {
            case "NOT_FOUND" -> ChatBlock.notice("info", "Nothing found",
                    message == null ? "Nothing was found, or you are not allowed to see it." : message);
            case "INVALID_ARGUMENT" -> ChatBlock.notice("warning", "I could not use that request",
                    message == null ? "Please check the details and ask again." : message);
            case "NOT_ALLOWED" -> ChatBlock.notice("warning", "Not available for your account",
                    "This is not available for your account.");
            case "BUSY" -> ChatBlock.notice("warning", "Busy", "Too many requests right now. Please try again shortly.");
            default -> ChatBlock.notice("warning", "Temporarily unavailable",
                    "This information is temporarily unavailable. Please try again later.");
        });
    }

    // ------------------------------------------------------------ helpers

    private static Field field(String key, Object value) {
        if (value == null) {
            return null;
        }
        String shown = scalar(value);
        if (shown.isBlank()) {
            return null;
        }
        return new Field(label(key), shown, kind(shown));
    }

    /** A value as people read it: booleans Yes/No, numbers without a trailing ".0", everything else as returned. */
    static String scalar(Object value) {
        if (value instanceof Boolean flag) {
            return flag ? "Yes" : "No";
        }
        if (value instanceof Double number && number == Math.rint(number) && !Double.isInfinite(number)) {
            return String.valueOf(number.longValue());
        }
        return String.valueOf(value);
    }

    static String kind(String shown) {
        if (ISO_DATE_TIME.matcher(shown).matches()) {
            return "datetime";
        }
        if (ISO_DATE.matcher(shown).matches()) {
            return "date";
        }
        return MONEY.matcher(shown).matches() ? "money" : "text";
    }

    static String label(String key) {
        return LABELS.getOrDefault(key, humanize(key));
    }

    /** {@code needsAttention} to "Needs attention", {@code CHECKED_IN} to "Checked in". */
    static String humanize(String key) {
        String spaced = key.contains("_") ? key.toLowerCase(Locale.ROOT).replace('_', ' ')
                : key.replaceAll("([a-z0-9])([A-Z])", "$1 $2").toLowerCase(Locale.ROOT);
        return spaced.isEmpty() ? spaced : Character.toUpperCase(spaced.charAt(0)) + spaced.substring(1);
    }

    static String tone(String status) {
        return switch (status.toUpperCase(Locale.ROOT)) {
            case "CONFIRMED", "SUCCESS", "SUCCEEDED", "PAID", "COMPLETED", "CHECKED_OUT", "RESOLVED", "CLOSED", "ACTIVE",
                    "APPROVED", "PUBLISHED" -> "success";
            case "PENDING", "PENDING_PAYMENT", "HELD", "OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "REQUESTED",
                    "PROCESSING", "PARTIALLY_REFUNDED", "NO_SHOW", "DRAFT" -> "warning";
            case "FAILED", "CANCELLED", "REJECTED", "EXPIRED", "ESCALATED", "CANCEL_FAILED", "REFUND_FAILED" -> "danger";
            case "CHECKED_IN", "REFUNDED" -> "info";
            default -> "neutral";
        };
    }

    private static String firstText(Map<?, ?> map, List<String> keys) {
        for (String key : keys) {
            String value = text(map.get(key));
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }

    private static String text(Object value) {
        return value == null ? null : scalar(value);
    }

    private static Integer integer(Object value) {
        return value instanceof Number number ? number.intValue() : null;
    }

    private static String singular(String noun) {
        return noun.endsWith("ies") ? noun.substring(0, noun.length() - 3) + "y"
                : noun.endsWith("s") ? noun.substring(0, noun.length() - 1) : noun;
    }
}
