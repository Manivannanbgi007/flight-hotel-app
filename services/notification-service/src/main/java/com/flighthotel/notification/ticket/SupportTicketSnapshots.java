package com.flighthotel.notification.ticket;

import java.time.Clock;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.events.support.SupportTicketSnapshot;

/**
 * Publishes the whole support ticket as it is now ({@code SupportTicketSnapshot} on {@code support.events}, key =
 * ticket id) for read models such as search-service: event-carried state transfer, so they never have to ask
 * notification-service.
 * <p>
 * {@link #changed} is called on every change of a ticket (through {@link TicketService}); the snapshot itself is
 * written to the outbox just before the transaction commits, once per ticket and transaction, so it carries the final
 * state of that transaction (an agent's reply adds a message, changes the status and may assign the ticket in one go).
 */
@Component
public class SupportTicketSnapshots {

    static final String AGGREGATE_TYPE = "support";
    private static final Logger log = LoggerFactory.getLogger(SupportTicketSnapshots.class);

    private final OutboxEventPublisher outbox;
    private final SupportTicketRepository tickets;
    private final Clock clock;

    public SupportTicketSnapshots(OutboxEventPublisher outbox, SupportTicketRepository tickets, Clock clock) {
        this.outbox = outbox;
        this.tickets = tickets;
        this.clock = clock;
    }

    /** The ticket changed in the current transaction: its snapshot goes out with the commit. */
    public void changed(UUID ticketId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            log.warn("Support ticket {} changed outside a transaction: no snapshot published", ticketId);
            return;
        }
        // Looked up among the current transaction's synchronizations (not a bound resource), so a nested
        // REQUIRES_NEW transaction gets its own list and the outer one is untouched.
        PendingSnapshots pending = TransactionSynchronizationManager.getSynchronizations().stream()
                .filter(PendingSnapshots.class::isInstance).map(PendingSnapshots.class::cast).findFirst()
                .orElseGet(() -> {
                    PendingSnapshots created = new PendingSnapshots();
                    TransactionSynchronizationManager.registerSynchronization(created);
                    return created;
                });
        pending.ids.add(ticketId);
    }

    /** Writes the snapshot now (the backfill and the development seed; normal changes go through {@link #changed}). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void publish(SupportTicket ticket) {
        outbox.publish(AGGREGATE_TYPE, ticket.getId().toString(), snapshot(ticket));
    }

    SupportTicketSnapshot snapshot(SupportTicket ticket) {
        return SupportTicketSnapshot.newBuilder()
                .setTicketId(ticket.getId().toString())
                .setTicketNumber(ticket.getTicketNumber())
                .setUserId(ticket.getUserId() == null ? null : ticket.getUserId().toString())
                .setCustomerEmail(ticket.getCustomerEmail())
                .setBookingId(ticket.getBookingId() == null ? null : ticket.getBookingId().toString())
                .setBookingReference(ticket.getBookingReference())
                .setSubject(ticket.getSubject())
                .setCategory(ticket.getCategory().name())
                .setStatus(ticket.getStatus().name())
                .setPriority(ticket.getPriority())
                .setAssignedAgentId(ticket.getAssignedAgentId() == null ? null : ticket.getAssignedAgentId().toString())
                .setCreatedAt(ticket.getCreatedAt() != null ? ticket.getCreatedAt() : clock.instant())
                .setLastMessageAt(ticket.getLastMessageAt())
                .setResolvedAt(ticket.getResolvedAt())
                .setClosedAt(ticket.getClosedAt())
                .setChangedAt(clock.instant())
                .build();
    }

    /** The tickets changed in one transaction; their snapshots are written just before it commits. */
    private final class PendingSnapshots implements TransactionSynchronization {

        private final Set<UUID> ids = new LinkedHashSet<>();

        @Override
        public void beforeCommit(boolean readOnly) {
            for (UUID id : ids) {
                // From the persistence context: the same (managed) ticket the transaction changed.
                tickets.findById(id).ifPresent(SupportTicketSnapshots.this::publish);
            }
        }
    }
}
