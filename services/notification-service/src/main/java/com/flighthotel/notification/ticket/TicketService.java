package com.flighthotel.notification.ticket;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.persistence.SecurityAuditorAware;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.security.Roles;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.events.booking.BookingCancellationFailed;
import com.flighthotel.notification.projection.BookingContacts;
import com.flighthotel.notification.projection.BookingContacts.BookingContact;
import com.flighthotel.notification.service.NotificationService;
import com.flighthotel.notification.ticket.SupportTicket.Category;
import com.flighthotel.notification.ticket.SupportTicket.Status;

import jakarta.persistence.criteria.Predicate;

/**
 * Support tickets (API_DOCUMENTATION.md sections 10c and 14.6): customers open, read, reply and close their own tickets
 * ({@code 404} for anyone else's); staff with {@code SUPPORT_TICKET_MANAGE} work the queue: filter, take or hand over a
 * ticket, change its status and priority, and answer (the customer gets a bell entry and an e-mail). A refused
 * cancellation opens a ticket automatically.
 */
@Service
public class TicketService {

    static final String MANAGE = "SUPPORT_TICKET_MANAGE";
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final Logger log = LoggerFactory.getLogger(TicketService.class);
    private static final char[] ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ".toCharArray();
    private static final SecureRandom RANDOM = new SecureRandom();

    private final SupportTicketRepository tickets;
    private final TicketMessageRepository messages;
    private final BookingContacts contacts;
    private final NotificationService notifications;
    private final RealtimePublisher realtime;
    private final TicketEmails emails;
    private final AuditPublisher audit;
    private final SupportTicketSnapshots snapshots;
    private final Clock clock;

    public TicketService(SupportTicketRepository tickets, TicketMessageRepository messages, BookingContacts contacts,
            NotificationService notifications, RealtimePublisher realtime, TicketEmails emails, AuditPublisher audit,
            SupportTicketSnapshots snapshots, Clock clock) {
        this.tickets = tickets;
        this.messages = messages;
        this.contacts = contacts;
        this.notifications = notifications;
        this.realtime = realtime;
        this.emails = emails;
        this.audit = audit;
        this.snapshots = snapshots;
        this.clock = clock;
    }

    public record TicketSummary(UUID id, String ticketNumber, String subject, Category category, Status status,
            UUID bookingId, String bookingReference, Instant createdAt, Instant lastMessageAt, String lastMessageBy) {

        static TicketSummary of(SupportTicket ticket) {
            return new TicketSummary(ticket.getId(), ticket.getTicketNumber(), ticket.getSubject(),
                    ticket.getCategory(), ticket.getStatus(), ticket.getBookingId(), ticket.getBookingReference(),
                    ticket.getCreatedAt(), ticket.getLastMessageAt(), ticket.getLastMessageBy());
        }
    }

    public record MessageView(UUID id, String authorRole, String message, Instant createdAt) {
    }

    /** {@code customerEmail}, {@code priority} and the assignment are only filled for staff. */
    public record TicketDetails(UUID id, String ticketNumber, String subject, Category category, Status status,
            UUID bookingId, String bookingReference, Instant createdAt, Instant lastMessageAt, String lastMessageBy,
            Instant closedAt, List<MessageView> messages, String customerEmail, String priority, UUID assignedAgentId,
            Boolean assignedToMe) {
    }

    /** A row of the agents' queue. */
    public record AgentTicketRow(UUID id, String ticketNumber, String subject, Category category, Status status,
            String priority, UUID bookingId, String bookingReference, String customerEmail, UUID assignedAgentId,
            boolean assignedToMe, Instant createdAt, Instant lastMessageAt, String lastMessageBy) {
    }

    /**
     * Counts for the support pages. {@code resolved} are the tickets waiting to be closed, {@code highPriority} the
     * HIGH ones that are not resolved or closed yet, {@code total} every ticket ever opened.
     */
    /**
     * The customer's own counts. {@code inProgress} = being worked on or escalated, {@code waitingForYou} = support
     * asked something, {@code resolved} = solved (still open to a reply) and {@code closed} = final.
     */
    public record MySummary(long total, long open, long inProgress, long waitingForYou, long resolved, long closed) {
    }

    public record QueueSummary(long open, long inProgress, long waitingCustomer, long escalated, long unassigned,
            long assignedToMe, long resolved, long highPriority, long total) {
    }

    // ------------------------------------------------------------------ customer API

    @PreAuthorize("isAuthenticated()")
    @Transactional
    public TicketDetails open(String subject, Category category, UUID bookingId, String message) {
        AuthenticatedUser user = CurrentUser.require();
        String reference = null;
        if (bookingId != null) {
            BookingContact booking = contacts.find(bookingId).filter(found -> found.userId().equals(user.id()))
                    .orElseThrow(() -> new BusinessRuleException("INVALID_BOOKING",
                            "Choose one of your own bookings.", Map.of("field", "bookingId")));
            reference = booking.bookingReference();
        }
        Instant now = clock.instant();
        SupportTicket ticket = tickets.save(SupportTicket.open(new SupportTicket.Opened(newTicketNumber(), user.id(),
                user.email(), bookingId, reference, subject.strip(), category, "NORMAL", null), "CUSTOMER", now));
        messages.save(new TicketMessage(ticket.getId(), user.id().toString(), "CUSTOMER", message.strip(), now));
        changed(ticket);
        log.info("Support ticket opened number={} category={}", ticket.getTicketNumber(), category);
        return details(ticket);
    }

    /**
     * My tickets, latest activity first. {@code query} finds a ticket number (exact) or words of the subject; only the
     * caller's own tickets can ever match.
     */
    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public PageResponse<TicketSummary> mine(Status status, Category category, String query, int page, int size) {
        UUID userId = CurrentUser.require().id();
        PageRequest paging = PageRequest.of(Math.max(page, 0), Math.clamp(size, 1, 50),
                Sort.by(Sort.Direction.DESC, "lastMessageAt").and(Sort.by(Sort.Direction.DESC, "id")));
        String text = query == null ? "" : query.strip().toLowerCase(java.util.Locale.ROOT);
        Specification<SupportTicket> filter = (root, criteria, cb) -> {
            List<Predicate> where = new java.util.ArrayList<>();
            where.add(cb.equal(root.get("userId"), userId));
            if (status != null) {
                where.add(cb.equal(root.get("status"), status));
            }
            if (category != null) {
                where.add(cb.equal(root.get("category"), category));
            }
            if (!text.isEmpty()) {
                String like = "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
                where.add(cb.or(cb.equal(root.get("ticketNumber"), text.toUpperCase(java.util.Locale.ROOT)),
                        cb.like(cb.lower(root.get("subject")), like, '\\')));
            }
            return cb.and(where.toArray(Predicate[]::new));
        };
        return PageResponse.from(tickets.findAll(filter, paging), TicketSummary::of);
    }

    /** The counts above My Support: this customer's tickets per status. */
    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public MySummary mySummary() {
        Map<Status, Long> counts = new java.util.EnumMap<>(Status.class);
        for (Object[] row : tickets.countsByStatus(CurrentUser.require().id())) {
            counts.put((Status) row[0], (Long) row[1]);
        }
        long total = counts.values().stream().mapToLong(Long::longValue).sum();
        return new MySummary(total, counts.getOrDefault(Status.OPEN, 0L),
                counts.getOrDefault(Status.IN_PROGRESS, 0L) + counts.getOrDefault(Status.ESCALATED, 0L),
                counts.getOrDefault(Status.WAITING_CUSTOMER, 0L), counts.getOrDefault(Status.RESOLVED, 0L),
                counts.getOrDefault(Status.CLOSED, 0L));
    }

    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public TicketDetails get(UUID id) {
        return details(readable(tickets.findById(id), id));
    }

    @PreAuthorize("isAuthenticated()")
    @Transactional
    public MessageView reply(UUID id, String text) {
        AuthenticatedUser user = CurrentUser.require();
        SupportTicket ticket = readable(tickets.lockById(id), id);
        if (ticket.isClosed()) {
            throw new ConflictException("TICKET_CLOSED", "This ticket is closed. Please open a new one.");
        }
        boolean customer = ticket.getUserId().equals(user.id());
        String role = customer ? "CUSTOMER" : user.hasRole(Roles.ADMIN) ? Roles.ADMIN : Roles.SUPPORT_AGENT;
        Instant now = clock.instant();
        TicketMessage message = messages.save(new TicketMessage(ticket.getId(), user.id().toString(), role,
                text.strip(), now));
        ticket.messageAdded(customer ? "CUSTOMER" : "SUPPORT", now);
        if (!customer) {
            if (ticket.getAssignedAgentId() == null) {
                ticket.assign(user.id(), now);   // whoever answers first owns the ticket
            }
            notifications.create(ticket.getUserId(), "SUPPORT", "New reply on your support ticket",
                    "Our support team answered your ticket " + ticket.getTicketNumber() + ".",
                    "/account/support/" + ticket.getId(), "ticket-reply-" + message.getId());
            emails.answered(ticket, message.getId());
        }
        changed(ticket);
        return view(message);
    }

    @PreAuthorize("isAuthenticated()")
    @Transactional
    public TicketDetails close(UUID id) {
        SupportTicket ticket = readable(tickets.lockById(id), id);
        if (!ticket.isClosed()) {
            ticket.close(clock.instant());
            changed(ticket);
        }
        return details(ticket);
    }

    // ------------------------------------------------------------------ agents (Phase 9)

    /**
     * The queue: {@code assigned} = ME, UNASSIGNED or ANY; {@code query} = ticket number, customer e-mail or words of
     * the subject. Escalated and high-priority work is easiest to find with the filters; the default order is the
     * longest-waiting last message first ({@code sort=lastMessageAt,asc}), or {@code createdAt,desc|asc}.
     */
    @PreAuthorize("hasAuthority('SUPPORT_TICKET_MANAGE')")
    @Transactional(readOnly = true)
    public PageResponse<AgentTicketRow> queue(Status status, Category category, String priority, String assigned,
            String query, UUID agent, LocalDate from, LocalDate to, int page, int size, String sort) {
        UUID me = CurrentUser.require().id();
        String text = query == null ? "" : query.strip();
        if (from != null && to != null && to.isBefore(from)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_RANGE", "'to' must not be before 'from'.");
        }
        Instant createdFrom = from == null ? null : from.atStartOfDay(INDIA).toInstant();
        Instant createdBefore = to == null ? null : to.plusDays(1).atStartOfDay(INDIA).toInstant();
        Specification<SupportTicket> filter = (root, criteria, cb) -> {
            List<Predicate> where = new java.util.ArrayList<>();
            if (status != null) {
                where.add(cb.equal(root.get("status"), status));
            }
            if (category != null) {
                where.add(cb.equal(root.get("category"), category));
            }
            if (priority != null && !priority.isBlank()) {
                where.add(cb.equal(root.get("priority"), priority.strip().toUpperCase(java.util.Locale.ROOT)));
            }
            switch (assigned == null ? "ANY" : assigned.strip().toUpperCase(java.util.Locale.ROOT)) {
                case "ME" -> where.add(cb.equal(root.get("assignedAgentId"), me));
                case "UNASSIGNED" -> where.add(cb.isNull(root.get("assignedAgentId")));
                case "ANY" -> { }
                default -> throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_FILTER",
                        "assigned must be ME, UNASSIGNED or ANY.");
            }
            if (agent != null) {
                where.add(cb.equal(root.get("assignedAgentId"), agent));
            }
            if (createdFrom != null) {
                where.add(cb.greaterThanOrEqualTo(root.get("createdAt"), createdFrom));
            }
            if (createdBefore != null) {
                where.add(cb.lessThan(root.get("createdAt"), createdBefore));
            }
            if (!text.isEmpty()) {
                String like = "%" + text.toLowerCase(java.util.Locale.ROOT) + "%";
                where.add(cb.or(cb.equal(root.get("ticketNumber"), text.toUpperCase(java.util.Locale.ROOT)),
                        cb.equal(cb.lower(root.get("customerEmail")), text.toLowerCase(java.util.Locale.ROOT)),
                        cb.like(cb.lower(root.get("subject")), like)));
            }
            return cb.and(where.toArray(Predicate[]::new));
        };
        PageRequest paging = PageRequest.of(Math.max(page, 0), Math.clamp(size, 1, 100), queueSort(sort));
        return PageResponse.from(tickets.findAll(filter, paging), ticket -> new AgentTicketRow(ticket.getId(),
                ticket.getTicketNumber(), ticket.getSubject(), ticket.getCategory(), ticket.getStatus(),
                ticket.getPriority(), ticket.getBookingId(), ticket.getBookingReference(), ticket.getCustomerEmail(),
                ticket.getAssignedAgentId(), me.equals(ticket.getAssignedAgentId()), ticket.getCreatedAt(),
                ticket.getLastMessageAt(), ticket.getLastMessageBy()));
    }

    @PreAuthorize("hasAuthority('SUPPORT_TICKET_MANAGE')")
    @Transactional(readOnly = true)
    public QueueSummary summary() {
        UUID me = CurrentUser.require().id();
        return new QueueSummary(tickets.countByStatus(Status.OPEN), tickets.countByStatus(Status.IN_PROGRESS),
                tickets.countByStatus(Status.WAITING_CUSTOMER), tickets.countByStatus(Status.ESCALATED),
                tickets.countUnassignedOpen(), tickets.countOpenAssignedTo(me), tickets.countByStatus(Status.RESOLVED),
                tickets.countOpenHighPriority(), tickets.count());
    }

    /** Takes the ticket ({@code agentId} null) or hands it to a colleague. */
    @PreAuthorize("hasAuthority('SUPPORT_TICKET_MANAGE')")
    @Transactional
    public TicketDetails assign(UUID id, UUID agentId) {
        AuthenticatedUser user = CurrentUser.require();
        SupportTicket ticket = tickets.lockById(id).orElseThrow(() -> new ResourceNotFoundException("Ticket", id));
        if (ticket.isClosed()) {
            throw new ConflictException("TICKET_CLOSED", "This ticket is closed.");
        }
        UUID to = agentId == null ? user.id() : agentId;
        ticket.assign(to, clock.instant());
        audit.record("TICKET_ASSIGNED", "TICKET", id.toString(), Map.of("ticketNumber", ticket.getTicketNumber(),
                "assignedAgentId", to.toString()));
        changed(ticket);
        return details(ticket);
    }

    @PreAuthorize("hasAuthority('SUPPORT_TICKET_MANAGE')")
    @Transactional
    public TicketDetails changeStatus(UUID id, Status status, String priority) {
        SupportTicket ticket = tickets.lockById(id).orElseThrow(() -> new ResourceNotFoundException("Ticket", id));
        if (ticket.isClosed() && status != Status.CLOSED) {
            throw new ConflictException("TICKET_CLOSED", "This ticket is closed. The customer can open a new one.");
        }
        Status previous = ticket.getStatus();
        ticket.changeStatus(status, priority, clock.instant());
        audit.record("TICKET_STATUS_CHANGED", "TICKET", id.toString(), Map.of("ticketNumber",
                ticket.getTicketNumber(), "from", previous.name(), "to", status.name(), "priority",
                ticket.getPriority()));
        changed(ticket);
        return details(ticket);
    }

    private static Sort queueSort(String sort) {
        if (sort == null || sort.isBlank()) {
            return Sort.by(Sort.Direction.ASC, "lastMessageAt");
        }
        String[] parts = sort.split(",");
        String field = parts[0].strip();
        Sort.Direction direction = parts.length > 1 ? Sort.Direction.fromOptionalString(parts[1].strip()).orElse(null)
                : Sort.Direction.ASC;
        if (!List.of("lastMessageAt", "createdAt").contains(field) || direction == null || parts.length > 2) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SORT",
                    "sort must be lastMessageAt or createdAt, optionally followed by ,asc or ,desc.");
        }
        return Sort.by(direction, field).and(Sort.by(Sort.Direction.ASC, "id"));
    }

    // ------------------------------------------------------------------ opened automatically

    /** The hotel or airline refused a cancellation: a ticket so support follows up (BOOKING_WORKFLOW.md section 4). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void cancellationRefused(BookingCancellationFailed failed, String eventId) {
        if (tickets.findBySourceEventId(eventId).isPresent()) {
            return;
        }
        Instant now = clock.instant();
        UUID userId = UUID.fromString(failed.getUserId());
        SupportTicket ticket = tickets.save(SupportTicket.open(new SupportTicket.Opened(newTicketNumber(), userId,
                failed.getContactEmail(), UUID.fromString(failed.getBookingId()), failed.getBookingReference(),
                limit("Cancellation not possible: " + failed.getBookingReference(), 120), Category.CANCELLATION,
                "HIGH", eventId), "SYSTEM", now));
        messages.save(new TicketMessage(ticket.getId(), SecurityAuditorAware.SYSTEM, "SYSTEM", limit(
                "We could not cancel booking " + failed.getBookingReference() + " (" + failed.getTitle() + "): "
                        + failed.getMessage() + " The booking is still valid. Our support team will contact you; "
                        + "you can reply here.", 2000), now));
        notifications.create(userId, "SUPPORT", "We opened a support ticket", "Ticket " + ticket.getTicketNumber()
                + " about booking " + failed.getBookingReference() + ": our team will follow up.",
                "/account/support/" + ticket.getId(), eventId + "-ticket");
        changed(ticket);
        log.info("Support ticket opened for a refused cancellation number={} booking={}", ticket.getTicketNumber(),
                failed.getBookingReference());
    }

    // ------------------------------------------------------------------ helpers

    private SupportTicket readable(java.util.Optional<SupportTicket> found, UUID id) {
        AuthenticatedUser user = CurrentUser.require();
        return found.filter(ticket -> ticket.getUserId().equals(user.id()) || user.hasPermission(MANAGE))
                .orElseThrow(() -> new ResourceNotFoundException("Ticket", id));
    }

    private TicketDetails details(SupportTicket ticket) {
        AuthenticatedUser user = CurrentUser.require();
        boolean staff = user.hasPermission(MANAGE);
        return new TicketDetails(ticket.getId(), ticket.getTicketNumber(), ticket.getSubject(), ticket.getCategory(),
                ticket.getStatus(), ticket.getBookingId(), ticket.getBookingReference(), ticket.getCreatedAt(),
                ticket.getLastMessageAt(), ticket.getLastMessageBy(), ticket.getClosedAt(),
                messages.findByTicketIdOrderByCreatedAtAscIdAsc(ticket.getId()).stream().map(TicketService::view)
                        .toList(), staff ? ticket.getCustomerEmail() : null, staff ? ticket.getPriority() : null,
                staff ? ticket.getAssignedAgentId() : null,
                staff ? user.id().equals(ticket.getAssignedAgentId()) : null);
    }

    private static MessageView view(TicketMessage message) {
        return new MessageView(message.getId(), message.getAuthorRole(), message.getMessage(), message.getCreatedAt());
    }

    /**
     * Every change of a ticket ends here: the screens refresh ({@code support.ticket-changed}) and the ticket's
     * snapshot is published with the commit ({@link SupportTicketSnapshots}).
     */
    private void changed(SupportTicket ticket) {
        snapshots.changed(ticket.getId());
        realtime.publish(RealtimeMessage.of("support.ticket-changed", "TICKET", ticket.getId().toString(),
                        Map.of("status", ticket.getStatus().name())),
                RealtimeAudience.user(ticket.getUserId()).andRoles(Roles.SUPPORT_AGENT, Roles.ADMIN));
    }

    private String newTicketNumber() {
        for (int attempt = 0; attempt < 5; attempt++) {
            StringBuilder number = new StringBuilder("TK-");
            for (int i = 0; i < 8; i++) {
                number.append(ALPHABET[RANDOM.nextInt(ALPHABET.length)]);
            }
            if (!tickets.existsByTicketNumber(number.toString())) {
                return number.toString();
            }
        }
        throw new IllegalStateException("Could not generate a unique ticket number");
    }

    private static String limit(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max);
    }
}
