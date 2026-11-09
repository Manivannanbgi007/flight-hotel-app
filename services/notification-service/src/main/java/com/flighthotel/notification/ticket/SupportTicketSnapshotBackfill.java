package com.flighthotel.notification.ticket;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import jakarta.persistence.EntityManager;

/**
 * Publishes the snapshot of every existing support ticket once, so search-service also knows the tickets opened before
 * snapshots existed; later changes publish their own ({@link SupportTicketSnapshots}). The {@code data_backfills} row
 * is locked while the job runs and marked done in the same transaction: with several instances exactly one does the
 * work, and if it fails nothing is marked and the next start tries again (read models keep the latest snapshot, so
 * repeats do no harm).
 */
@Component
public class SupportTicketSnapshotBackfill {

    static final String NAME = "support-ticket-snapshots";
    private static final Logger log = LoggerFactory.getLogger(SupportTicketSnapshotBackfill.class);
    private static final int BATCH = 200;

    private final JdbcClient jdbc;
    private final SupportTicketRepository tickets;
    private final SupportTicketSnapshots snapshots;
    private final TransactionTemplate transactions;
    private final EntityManager entityManager;
    private final Clock clock;

    public SupportTicketSnapshotBackfill(JdbcClient jdbc, SupportTicketRepository tickets,
            SupportTicketSnapshots snapshots, TransactionTemplate transactions, EntityManager entityManager,
            Clock clock) {
        this.jdbc = jdbc;
        this.tickets = tickets;
        this.snapshots = snapshots;
        this.transactions = transactions;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStart() {
        try {
            Integer published = transactions.execute(status -> backfill());
            if (published != null && published > 0) {
                log.info("Support ticket snapshots published for {} existing tickets", published);
            }
        } catch (RuntimeException ex) {
            log.error("Support ticket snapshot backfill failed; it runs again at the next start", ex);
        }
    }

    /** @return the number of snapshots written (0 when already done) */
    int backfill() {
        boolean pending = jdbc.sql("SELECT done_at IS NULL FROM data_backfills WHERE name = :name FOR UPDATE")
                .param("name", NAME).query(Boolean.class).optional().orElse(false);
        if (!pending) {
            return 0;
        }
        int count = 0;
        UUID after = null;
        while (true) {
            List<UUID> ids = after == null ? tickets.findIdsOrderById(PageRequest.ofSize(BATCH))
                    : tickets.findIdsAfter(after, PageRequest.ofSize(BATCH));
            if (ids.isEmpty()) {
                break;
            }
            for (UUID id : ids) {
                tickets.findById(id).ifPresent(snapshots::publish);
                count++;
            }
            after = ids.getLast();
            entityManager.clear();   // nothing changed; keeps the persistence context small
        }
        jdbc.sql("UPDATE data_backfills SET done_at = :now WHERE name = :name")
                .param("now", java.sql.Timestamp.from(clock.instant())).param("name", NAME).update();
        return count;
    }
}
