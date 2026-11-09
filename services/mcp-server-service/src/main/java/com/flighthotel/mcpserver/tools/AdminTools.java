package com.flighthotel.mcpserver.tools;

import static com.flighthotel.common.security.Roles.ADMIN;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.flighthotel.mcpserver.gateway.GatewayClient;

import tools.jackson.databind.JsonNode;

/**
 * Admin figures: the dashboard, booking, payment and refund search, and the reports. The services check
 * {@code REPORT_VIEW}, {@code BOOKING_READ_ANY} and {@code PAYMENT_READ_ANY} again.
 */
@Component
public class AdminTools implements ToolSet {

    static final List<String> BOOKING_STATUSES = List.of("INITIATED", "PENDING_PAYMENT", "PAYMENT_SUCCESS",
            "SUPPLIER_PENDING", "CONFIRMED", "COMPLETED", "CANCELLATION_PENDING", "CANCELLED", "REFUND_PENDING",
            "REFUNDED", "FAILED", "EXPIRED");

    private final GatewayClient gateway;

    public AdminTools(GatewayClient gateway) {
        this.gateway = gateway;
    }

    @Override
    public List<ToolDefinition> tools() {
        return List.of(dashboard(), searchBookings(), searchPayments(), searchRefunds(), report());
    }

    private ToolDefinition dashboard() {
        return ToolDefinition.named("admin_dashboard")
                .title("Admin dashboard")
                .description("Business figures for a period: paid bookings (hotel, flight), customers, payments, "
                        + "revenue, refunds, top destinations and hotels.")
                .roles(ADMIN)
                .param(Ranges.range(Ranges.DASHBOARD_PRESETS))
                .param(Ranges.from("First day for CUSTOM, YYYY-MM-DD"))
                .param(Ranges.to("Last day for CUSTOM, YYYY-MM-DD"))
                .handler((args, caller) -> {
                    JsonNode dashboard = gateway.get(caller, "/api/admin/dashboard",
                            Ranges.query(args, Ranges.DASHBOARD_MAX_DAYS));
                    return dashboard(dashboard);
                });
    }

    static Map<String, Object> dashboard(JsonNode dashboard) {
        String currency = Out.text(dashboard.path("revenue"), "currency");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("range", Out.pick(dashboard.path("range"), "preset", "from", "to"));
        out.put("customers", Out.pick(dashboard.path("customers"), "total", "newInRange"));
        JsonNode bookings = dashboard.path("bookings");
        Map<String, Object> counts = Out.pick(bookings, "hotel", "flight", "upcoming", "completed", "cancelled",
                "pending", "failed");
        counts.put("paidTotal", bookings.path("hotel").asLong(0) + bookings.path("flight").asLong(0));
        out.put("bookings", counts);
        JsonNode payments = dashboard.path("payments");
        Map<String, Object> money = new LinkedHashMap<>();
        Out.put(money, "successfulCount", Out.scalar(payments.get("successfulCount")));
        Out.money(money, "successfulAmount", payments, "successfulAmount", currency);
        Out.put(money, "pendingCount", Out.scalar(payments.get("pendingCount")));
        Out.money(money, "pendingAmount", payments, "pendingAmount", currency);
        // Dashboard v2 (Phase 11): failed attempts and the success rate.
        Out.put(money, "failedCount", Out.scalar(payments.get("failedCount")));
        Out.money(money, "failedAmount", payments, "failedAmount", currency);
        Out.put(money, "successRatePercent", Out.scalar(payments.get("successRate")));
        out.put("payments", money);
        Map<String, Object> revenue = new LinkedHashMap<>();
        Out.money(revenue, "gross", dashboard.path("revenue"), "gross", currency);
        Out.money(revenue, "refunds", dashboard.path("revenue"), "refunds", currency);
        Out.money(revenue, "net", dashboard.path("revenue"), "net", currency);
        out.put("revenue", revenue);
        JsonNode cancellations = dashboard.path("cancellations");
        if (cancellations.isObject()) {
            Map<String, Object> cancelled = Out.pick(cancellations, "count", "hotel", "flight");
            Out.put(cancelled, "ratePercent", Out.scalar(cancellations.get("rate")));
            Out.money(cancelled, "refundAmount", cancellations, "refundAmount", currency);
            out.put("cancellations", cancelled);
        }
        JsonNode comparison = dashboard.path("comparison");
        if (comparison.isObject()) {
            Map<String, Object> previous = new LinkedHashMap<>();
            Out.put(previous, "bookings", Ranges.change(comparison.get("bookings"), false));
            Out.put(previous, "netRevenue", Ranges.change(comparison.get("netRevenue"), true));
            Out.put(previous, "failedPayments", Ranges.change(comparison.get("failedPayments"), false));
            Out.put(out, "versusPreviousPeriod", previous);
        }
        out.put("topDestinations", Out.rows(dashboard.path("popularDestinations"), 3, row -> {
            Map<String, Object> view = Out.pick(row, "city", "bookings");
            Out.money(view, "revenue", row, "revenue", currency);
            return view;
        }));
        out.put("topHotels", Out.rows(dashboard.path("topHotels"), 3, row -> {
            Map<String, Object> view = Out.pick(row, "hotelName", "city", "bookings");
            Out.money(view, "revenue", row, "revenue", currency);
            return view;
        }));
        out.put("definitions", "bookings.hotel/flight/paidTotal = bookings created in the range that were paid; "
                + "pending = still waiting for payment or confirmation; failed = failed or expired; revenue = "
                + "payments captured in the range minus refunds completed in it.");
        return out;
    }

    private ToolDefinition searchBookings() {
        return ToolDefinition.named("search_bookings")
                .title("Booking search")
                .description("Search all bookings by reference, customer e-mail, PNR or hotel confirmation number, "
                        + "status, type and creation date. Returns the count and the newest rows.")
                .roles(ADMIN)
                .param(Param.text("q", "Reference, e-mail, PNR or confirmation number (exact)", 3, 120))
                .param(Param.oneOf("status", "Booking status", BOOKING_STATUSES))
                .param(Param.oneOf("type", "HOTEL or FLIGHT", List.of("HOTEL", "FLIGHT")))
                .param(Ranges.from("Created on or after, YYYY-MM-DD"))
                .param(Ranges.to("Created on or before, YYYY-MM-DD"))
                .param(Param.integer("limit", "Maximum rows (default 10)", 1, 20))
                .handler((args, caller) -> {
                    Ranges.checkDates(args.date("from"), args.date("to"), false);
                    int limit = args.integer("limit", 10);
                    Map<String, Object> query = new LinkedHashMap<>();
                    query.put("q", args.text("q"));
                    query.put("status", args.text("status"));
                    query.put("type", args.text("type"));
                    query.put("from", args.date("from"));
                    query.put("to", args.date("to"));
                    query.put("size", limit);
                    JsonNode page = gateway.get(caller, "/api/admin/bookings", query);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("count", Out.total(page));
                    out.put("bookings", Out.rows(Out.content(page), limit, row -> {
                        Map<String, Object> view = CustomerTools.row(row);
                        Out.put(view, "createdAt", Out.text(row, "createdAt"));
                        return view;
                    }));
                    return out;
                });
    }

    private ToolDefinition searchPayments() {
        return ToolDefinition.named("search_payments")
                .title("Payment search")
                .description("Search payment attempts by booking reference or payment id, status (SUCCESS, FAILED, "
                        + "...) and date. Returns the count and the newest rows.")
                .roles(ADMIN)
                .param(Param.text("q", "Booking reference or payment id", 3, 120))
                .param(Param.oneOf("status", "Payment status", List.of("INITIATED", "PENDING", "SUCCESS", "FAILED",
                        "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED")))
                .param(Ranges.from("On or after, YYYY-MM-DD"))
                .param(Ranges.to("On or before, YYYY-MM-DD"))
                .param(Param.integer("limit", "Maximum rows (default 10)", 1, 20))
                .handler((args, caller) -> {
                    Ranges.checkDates(args.date("from"), args.date("to"), false);
                    int limit = args.integer("limit", 10);
                    Map<String, Object> query = new LinkedHashMap<>();
                    query.put("q", args.text("q"));
                    query.put("status", args.text("status"));
                    query.put("from", args.date("from"));
                    query.put("to", args.date("to"));
                    query.put("size", limit);
                    JsonNode page = gateway.get(caller, "/api/admin/payments", query);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("count", Out.total(page));
                    out.put("payments", Out.rows(Out.content(page), limit, row -> {
                        Map<String, Object> view = CustomerTools.payment(row);
                        Out.put(view, "failureCode", Out.text(row, "failureCode"));
                        return view;
                    }));
                    return out;
                });
    }

    private ToolDefinition searchRefunds() {
        return ToolDefinition.named("search_refunds")
                .title("Refund search")
                .description("Search refunds by booking reference, status (PENDING, PROCESSED, FAILED) and date.")
                .roles(ADMIN)
                .param(Param.text("q", "Booking reference", 3, 120))
                .param(Param.oneOf("status", "Refund status", List.of("PENDING", "PROCESSED", "FAILED")))
                .param(Ranges.from("Created on or after, YYYY-MM-DD"))
                .param(Ranges.to("Created on or before, YYYY-MM-DD"))
                .param(Param.integer("limit", "Maximum rows (default 10)", 1, 20))
                .handler((args, caller) -> {
                    Ranges.checkDates(args.date("from"), args.date("to"), false);
                    int limit = args.integer("limit", 10);
                    Map<String, Object> query = new LinkedHashMap<>();
                    query.put("q", args.text("q"));
                    query.put("status", args.text("status"));
                    query.put("from", args.date("from"));
                    query.put("to", args.date("to"));
                    query.put("size", limit);
                    JsonNode page = gateway.get(caller, "/api/admin/refunds", query);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("count", Out.total(page));
                    out.put("refunds", Out.rows(Out.content(page), limit, row -> {
                        Map<String, Object> view = Out.pick(row, "bookingReference", "status", "reason",
                                "createdAt", "updatedAt");
                        Out.money(view, "amount", row, "amount", Out.currency(row));
                        Out.put(view, "failure", Out.shorten(Out.text(row, "failureReason"), 120));
                        return view;
                    }));
                    return out;
                });
    }

    private ToolDefinition report() {
        return ToolDefinition.named("run_report")
                .title("Report")
                .description("An admin report for a period with totals over all rows: bookings, revenue, payments, "
                        + "refunds, cancellations, destinations or customers.")
                .roles(ADMIN)
                .param(Param.oneOf("report", "Which report", List.of("BOOKINGS", "REVENUE", "PAYMENTS", "REFUNDS",
                        "CANCELLATIONS", "DESTINATIONS", "CUSTOMERS")).required())
                .param(Ranges.range())
                .param(Ranges.from("First day for CUSTOM, YYYY-MM-DD"))
                .param(Ranges.to("Last day for CUSTOM, YYYY-MM-DD"))
                .param(Param.text("status", "Status filter: bookings = booking status; payments = SUCCESS or "
                        + "FAILED; refunds = REQUESTED, COMPLETED or FAILED", 3, 30))
                .param(Param.oneOf("type", "HOTEL or FLIGHT (bookings, cancellations)", List.of("HOTEL", "FLIGHT")))
                .param(Param.integer("limit", "Rows to show (default 5)", 0, 20))
                .handler((args, caller) -> {
                    int limit = args.integer("limit", 5);
                    Map<String, Object> query = new LinkedHashMap<>(Ranges.query(args));
                    String status = args.text("status");
                    if (status != null && !status.toUpperCase().matches("[A-Z_]{3,30}")) {
                        throw new ToolInputException("status", "must be a status name like FAILED");
                    }
                    query.put("status", status == null ? null : status.toUpperCase());
                    query.put("type", args.text("type"));
                    query.put("size", Math.max(limit, 1));
                    JsonNode page = gateway.get(caller, "/api/admin/reports/{report}",
                            Map.of("report", args.text("report").toLowerCase()), query);
                    return report(page, limit);
                });
    }

    static Map<String, Object> report(JsonNode page, int limit) {
        Map<String, String> types = new LinkedHashMap<>();
        Map<String, String> labels = new LinkedHashMap<>();
        for (JsonNode column : page.path("columns")) {
            types.put(Out.text(column, "key"), Out.text(column, "type"));
            labels.put(Out.text(column, "key"), Out.text(column, "label"));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        Out.put(out, "report", Out.text(page, "title") != null ? Out.text(page, "title") : Out.text(page, "report"));
        out.put("range", Out.pick(page.path("range"), "preset", "from", "to"));
        out.put("rowCount", Out.total(page));
        Map<String, Object> totals = new LinkedHashMap<>();
        JsonNode totalsNode = page.path("totals");
        for (String key : totalsNode.propertyNames()) {
            totals.put(key, value(totalsNode.get(key), types.getOrDefault(key, guessType(key))));
        }
        out.put("totals", totals);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (JsonNode row : Out.content(page)) {
            if (rows.size() >= limit) {
                break;
            }
            Map<String, Object> view = new LinkedHashMap<>();
            for (String key : types.keySet()) {
                // Internal ids (paymentId, refundRequestId, ...) mean nothing to people and cost prompt tokens.
                if (!key.endsWith("Id")) {
                    Out.put(view, key, value(row.get(key), types.get(key)));
                }
            }
            rows.add(view);
        }
        Out.put(out, "rows", rows);
        return out;
    }

    private static Object value(JsonNode value, String type) {
        if ("MONEY".equals(type)) {
            return Out.money(value, "INR");
        }
        return Out.scalar(value);
    }

    private static String guessType(String key) {
        String lower = key.toLowerCase();
        return lower.contains("amount") || lower.contains("revenue") || lower.contains("gross")
                || lower.contains("net") || lower.contains("refund") && !lower.contains("count")
                || lower.contains("spent") || lower.contains("fee") ? "MONEY" : "NUMBER";
    }
}
