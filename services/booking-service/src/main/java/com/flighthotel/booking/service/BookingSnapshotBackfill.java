package com.flighthotel.booking.service;

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

import com.flighthotel.booking.repository.BookingRepository;

import jakarta.persistence.EntityManager;

/**
 * Publishes the snapshot of every existing booking once (Phase 9), so reporting-service also knows the bookings made
 * before snapshots existed; later changes publish their own. The {@code data_backfills} row is locked while the job
 * runs and marked done in the same transaction: with several instances exactly one does the work, and if it fails
 * nothing is marked and the next start tries again (read models keep the latest snapshot, so repeats do no harm).
 */
@Component
public class BookingSnapshotBackfill {

    static final String NAME = "booking-snapshots";
    private static final Logger log = LoggerFactory.getLogger(BookingSnapshotBackfill.class);
    private static final int BATCH = 200;

    private final JdbcClient jdbc;
    private final BookingRepository bookings;
    private final BookingSnapshots snapshots;
    private final TransactionTemplate transactions;
    private final EntityManager entityManager;
    private final Clock clock;

    public BookingSnapshotBackfill(JdbcClient jdbc, BookingRepository bookings, BookingSnapshots snapshots,
            TransactionTemplate transactions, EntityManager entityManager, Clock clock) {
        this.jdbc = jdbc;
        this.bookings = bookings;
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
                log.info("Booking snapshots published for {} existing bookings", published);
            }
        } catch (RuntimeException ex) {
            log.error("Booking snapshot backfill failed; it runs again at the next start", ex);
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
            List<UUID> ids = after == null ? bookings.findIdsOrderById(PageRequest.ofSize(BATCH))
                    : bookings.findIdsAfter(after, PageRequest.ofSize(BATCH));
            if (ids.isEmpty()) {
                break;
            }
            for (UUID id : ids) {
                bookings.findById(id).ifPresent(snapshots::publish);
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
