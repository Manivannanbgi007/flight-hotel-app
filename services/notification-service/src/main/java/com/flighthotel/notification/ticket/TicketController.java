package com.flighthotel.notification.ticket;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.notification.ticket.SupportTicket.Category;
import com.flighthotel.notification.ticket.SupportTicket.Status;
import com.flighthotel.notification.ticket.TicketService.MessageView;
import com.flighthotel.notification.ticket.TicketService.MySummary;
import com.flighthotel.notification.ticket.TicketService.TicketDetails;
import com.flighthotel.notification.ticket.TicketService.TicketSummary;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** The customer's support tickets (agents' queue: Phase 9). */
@RestController
@RequestMapping("/api/support/tickets")
@Tag(name = "Support tickets", description = "Open a ticket, follow the conversation, reply, close")
public class TicketController {

    private final TicketService tickets;

    public TicketController(TicketService tickets) {
        this.tickets = tickets;
    }

    public record OpenTicketRequest(
            @NotBlank @Size(min = 5, max = 120) String subject,
            @NotNull Category category,
            UUID bookingId,
            @NotBlank @Size(max = 2000) String message) {
    }

    public record ReplyRequest(@NotBlank @Size(max = 2000) String message) {
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Open a support ticket (optionally about one of my bookings)")
    public TicketDetails open(@Valid @RequestBody OpenTicketRequest request) {
        return tickets.open(request.subject(), request.category(), request.bookingId(), request.message());
    }

    @GetMapping
    @Operation(summary = "My tickets, latest activity first (filter by status, category, ticket number or subject words)")
    public PageResponse<TicketSummary> mine(@RequestParam(required = false) Status status,
            @RequestParam(required = false) Category category, @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return tickets.mine(status, category, q, page, size);
    }

    @GetMapping("/summary")
    @Operation(summary = "My ticket counts per status")
    public MySummary summary() {
        return tickets.mySummary();
    }

    @GetMapping("/{id}")
    @Operation(summary = "A ticket with its conversation")
    public TicketDetails get(@PathVariable UUID id) {
        return tickets.get(id);
    }

    @PostMapping("/{id}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Reply (reopens a waiting or resolved ticket; 409 when closed)")
    public MessageView reply(@PathVariable UUID id, @Valid @RequestBody ReplyRequest request) {
        return tickets.reply(id, request.message());
    }

    @PostMapping("/{id}/close")
    @Operation(summary = "Close the ticket (final)")
    public TicketDetails close(@PathVariable UUID id) {
        return tickets.close(id);
    }
}
