package com.flighthotel.identity.messaging;

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

import com.flighthotel.identity.repository.UserRepository;

import jakarta.persistence.EntityManager;

/**
 * Publishes a {@code UserSnapshot} of every account once (Phase 9), so reporting-service knows the accounts registered
 * before it started; later changes arrive as the usual identity events. The {@code data_backfills} row is locked while
 * the job runs and marked done in the same transaction: with several instances exactly one does the work, and after a
 * failure the next start tries again (read models keep the latest state, so repeats do no harm).
 */
@Component
public class UserSnapshotBackfill {

    static final String NAME = "user-snapshots";
    private static final Logger log = LoggerFactory.getLogger(UserSnapshotBackfill.class);
    private static final int BATCH = 200;

    private final JdbcClient jdbc;
    private final UserRepository users;
    private final IdentityEventPublisher events;
    private final TransactionTemplate transactions;
    private final EntityManager entityManager;
    private final Clock clock;

    public UserSnapshotBackfill(JdbcClient jdbc, UserRepository users, IdentityEventPublisher events,
            TransactionTemplate transactions, EntityManager entityManager, Clock clock) {
        this.jdbc = jdbc;
        this.users = users;
        this.events = events;
        this.transactions = transactions;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStart() {
        try {
            Integer published = transactions.execute(status -> backfill());
            if (published != null && published > 0) {
                log.info("User snapshots published for {} existing accounts", published);
            }
        } catch (RuntimeException ex) {
            log.error("User snapshot backfill failed; it runs again at the next start", ex);
        }
    }

    int backfill() {
        boolean pending = jdbc.sql("SELECT done_at IS NULL FROM data_backfills WHERE name = :name FOR UPDATE")
                .param("name", NAME).query(Boolean.class).optional().orElse(false);
        if (!pending) {
            return 0;
        }
        int count = 0;
        UUID after = null;
        while (true) {
            List<UUID> ids = after == null ? users.findIdsOrderById(PageRequest.ofSize(BATCH))
                    : users.findIdsAfter(after, PageRequest.ofSize(BATCH));
            if (ids.isEmpty()) {
                break;
            }
            for (UUID id : ids) {
                users.findById(id).ifPresent(events::userSnapshot);
                count++;
            }
            after = ids.getLast();
            entityManager.clear();
        }
        jdbc.sql("UPDATE data_backfills SET done_at = :now WHERE name = :name")
                .param("now", java.sql.Timestamp.from(clock.instant())).param("name", NAME).update();
        return count;
    }
}
