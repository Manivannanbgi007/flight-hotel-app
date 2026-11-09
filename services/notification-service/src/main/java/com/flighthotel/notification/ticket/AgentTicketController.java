package com.flighthotel.notification.ticket;

import java.time.LocalDate;
import java.util.UUID;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.notification.ticket.SupportMetricsService.SupportMetrics;
import com.flighthotel.notification.ticket.SupportTicket.Category;
import com.flighthotel.notification.ticket.SupportTicket.Status;
import com.flighthotel.notification.ticket.TicketService.AgentTicketRow;
import com.flighthotel.notification.ticket.TicketService.QueueSummary;
import com.flighthotel.notification.ticket.TicketService.TicketDetails;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * The support agents' ticket queue and dashboard figures (SUPPORT_TICKET_MANAGE, checked in {@link TicketService} and
 * {@link SupportMetricsService}). Reading a ticket and
 * replying use the shared {@code /api/support/tickets/{id}} endpoints.
 */
@RestController
@RequestMapping("/api/admin/support")
@Tag(name = "Support: ticket queue", description = "Ticket queue, summary, assignment and status for agents")
public class AgentTicketController {

    private final TicketService tickets;
    private final SupportMetricsService metrics;

    public AgentTicketController(TicketService tickets, SupportMetricsService metrics) {
        this.tickets = tickets;
        this.metrics = metrics;
    }

    public record AssignRequest(UUID agentId) {
    }

    public record StatusRequest(@NotNull Status status, @Pattern(regexp = "NORMAL|HIGH") String priority) {
    }

    @GetMapping("/tickets")
    @Operation(summary = "The ticket queue with filters (SUPPORT_TICKET_MANAGE)")
    public PageResponse<AgentTicketRow> queue(@RequestParam(required = false) Status status,
            @RequestParam(required = false) Category category, @RequestParam(required = false) String priority,
            @RequestParam(defaultValue = "ANY") String assigned, @RequestParam(required = false) String q,
            @RequestParam(required = false) UUID agent,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String sort) {
        return tickets.queue(status, category, priority, assigned, q, agent, from, to, page, size, sort);
    }

    @GetMapping("/summary")
    @Operation(summary = "Counts for the support dashboard (SUPPORT_TICKET_MANAGE)")
    public QueueSummary summary() {
        return tickets.summary();
    }

    @GetMapping("/metrics")
    @Operation(summary = "Support dashboard: tickets by status and age, opened vs resolved, response times "
            + "(SUPPORT_TICKET_MANAGE)",
            description = "range: a preset (default LAST_30_DAYS) or CUSTOM (from, to; at most five years). "
                    + "interval: DAY, WEEK, MONTH or YEAR (default by the length of the range).")
    public SupportMetrics metrics(@RequestParam(required = false) String range,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String interval) {
        return metrics.metrics(range, from, to, interval);
    }

    @PostMapping("/tickets/{id}/assign")
    @Operation(summary = "Take the ticket, or hand it to a colleague (SUPPORT_TICKET_MANAGE)")
    public TicketDetails assign(@PathVariable UUID id, @RequestBody(required = false) AssignRequest request) {
        return tickets.assign(id, request == null ? null : request.agentId());
    }

    @PatchMapping("/tickets/{id}/status")
    @Operation(summary = "Change the status and priority (SUPPORT_TICKET_MANAGE)")
    public TicketDetails status(@PathVariable UUID id, @Valid @RequestBody StatusRequest request) {
        return tickets.changeStatus(id, request.status(), request.priority());
    }
}
