package com.flighthotel.mcpserver.tools;

import static com.flighthotel.common.security.Roles.SUPPORT_AGENT;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.flighthotel.mcpserver.gateway.GatewayClient;

import tools.jackson.databind.JsonNode;

/** Support agents: the ticket queue and its summary, and the booking lookup ({@code SUPPORT_TICKET_MANAGE}, {@code BOOKING_READ_ANY}). */
@Component
public class SupportTools implements ToolSet {

    private final GatewayClient gateway;

    public SupportTools(GatewayClient gateway) {
        this.gateway = gateway;
    }

    @Override
    public List<ToolDefinition> tools() {
        return List.of(queue(), summary(), metrics(), findBookings());
    }

    private ToolDefinition queue() {
        return ToolDefinition.named("ticket_queue")
                .title("Ticket queue")
                .description("Support tickets by status, assignment and priority, oldest last message first.")
                .roles(SUPPORT_AGENT)
                .param(Param.oneOf("status", "Ticket status", List.of("OPEN", "IN_PROGRESS", "WAITING_CUSTOMER",
                        "ESCALATED", "RESOLVED", "CLOSED")))
                .param(Param.oneOf("assigned", "ME, UNASSIGNED or ANY (default ANY)",
                        List.of("ME", "UNASSIGNED", "ANY")))
                .param(Param.oneOf("priority", "NORMAL or HIGH", List.of("NORMAL", "HIGH")))
                .param(Param.text("q", "Ticket number, customer e-mail or words of the subject", 2, 120))
                .param(Param.integer("limit", "Maximum rows (default 10)", 1, 20))
                .handler((args, caller) -> {
                    int limit = args.integer("limit", 10);
                    Map<String, Object> query = new LinkedHashMap<>();
                    query.put("status", args.text("status"));
                    query.put("assigned", args.text("assigned", "ANY"));
                    query.put("priority", args.text("priority"));
                    query.put("q", args.text("q"));
                    query.put("size", limit);
                    JsonNode page = gateway.get(caller, "/api/admin/support/tickets", query);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("count", Out.total(page));
                    out.put("tickets", Out.rows(Out.content(page), limit, CustomerTools::ticket));
                    return out;
                });
    }

    private ToolDefinition summary() {
        return ToolDefinition.named("ticket_summary")
                .title("Ticket summary")
                .description("How many tickets are open, in progress, waiting for the customer, escalated, "
                        + "unassigned and assigned to me.")
                .roles(SUPPORT_AGENT)
                .handler((args, caller) -> Out.pick(gateway.get(caller, "/api/admin/support/summary", Map.of()),
                        "open", "inProgress", "waitingCustomer", "escalated", "unassigned", "assignedToMe"));
    }

    private ToolDefinition metrics() {
        return ToolDefinition.named("ticket_metrics")
                .title("Support metrics")
                .description("Support figures for a period: tickets opened and resolved, open tickets by age, "
                        + "first response and resolution times.")
                .roles(SUPPORT_AGENT)
                .param(Ranges.range(Ranges.DASHBOARD_PRESETS))
                .param(Ranges.from("First day for CUSTOM, YYYY-MM-DD"))
                .param(Ranges.to("Last day for CUSTOM, YYYY-MM-DD"))
                .handler((args, caller) -> {
                    JsonNode metrics = gateway.get(caller, "/api/admin/support/metrics",
                            Ranges.query(args, Ranges.DASHBOARD_MAX_DAYS));
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("range", Out.pick(metrics.path("range"), "preset", "from", "to"));
                    Out.put(out, "openNow", Out.scalar(metrics.get("open")));
                    Out.put(out, "byStatusNow", Out.pick(metrics.path("byStatus"), "OPEN", "IN_PROGRESS",
                            "WAITING_CUSTOMER", "ESCALATED", "RESOLVED", "CLOSED"));
                    Out.put(out, "opened", Out.scalar(metrics.get("opened")));
                    Out.put(out, "resolved", Out.scalar(metrics.get("resolved")));
                    Out.put(out, "openByAge", Out.rows(metrics.path("age").path("buckets"), 4,
                            bucket -> Out.pick(bucket, "label", "count")));
                    Out.put(out, "averageOpenAgeHours", Out.scalar(metrics.path("age").get("averageHours")));
                    Out.put(out, "firstResponse", Out.pick(metrics.path("firstResponse"), "averageMinutes",
                            "medianMinutes", "responded", "awaiting"));
                    Out.put(out, "averageResolutionHours", Out.scalar(metrics.path("resolution").get("averageHours")));
                    return out;
                });
    }

    private ToolDefinition findBookings() {
        return ToolDefinition.named("find_bookings")
                .title("Booking lookup")
                .description("Look up bookings by reference, customer e-mail, PNR or hotel confirmation number "
                        + "(exact), or list bookings that need attention.")
                .roles(SUPPORT_AGENT)
                .param(Param.text("q", "Reference, e-mail, PNR or confirmation number", 3, 120))
                .param(Param.bool("needsAttention", "Only bookings flagged for support"))
                .param(Param.integer("limit", "Maximum rows (default 10)", 1, 20))
                .handler((args, caller) -> {
                    int limit = args.integer("limit", 10);
                    Map<String, Object> query = new LinkedHashMap<>();
                    query.put("q", args.text("q"));
                    query.put("attention", Boolean.TRUE.equals(args.bool("needsAttention")) ? true : null);
                    query.put("size", limit);
                    JsonNode page = gateway.get(caller, "/api/support/bookings", query);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("count", Out.total(page));
                    out.put("bookings", Out.rows(Out.content(page), limit, CustomerTools::row));
                    return out;
                });
    }
}
