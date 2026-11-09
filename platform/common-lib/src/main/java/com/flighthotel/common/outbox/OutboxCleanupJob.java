package com.flighthotel.common.outbox;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Deletes old outbox rows. Debezium has already read them from the binlog, so they are only kept for
 * troubleshooting. Debezium is configured to skip delete events, so this does not publish anything.
 * <p>
 * Safe to run on several instances at the same time (the delete is idempotent).
 */
public class OutboxCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(OutboxCleanupJob.class);
    private static final int BATCH_SIZE = 5_000;

    private final JdbcClient jdbcClient;
    private final Duration retention;
    private final Clock clock;

    public OutboxCleanupJob(JdbcClient jdbcClient, Duration retention, Clock clock) {
        this.jdbcClient = jdbcClient;
        this.retention = retention;
        this.clock = clock;
    }

    @Scheduled(cron = "${travel.outbox.cleanup-cron:0 30 3 * * *}")
    public void deleteOldEvents() {
        Timestamp cutoff = Timestamp.from(Instant.now(clock).minus(retention));
        int total = 0;
        int deleted;
        do {
            // Small batches keep locks short on a busy table.
            deleted = jdbcClient.sql("DELETE FROM outbox_events WHERE created_at < :cutoff LIMIT " + BATCH_SIZE)
                    .param("cutoff", cutoff)
                    .update();
            total += deleted;
        } while (deleted == BATCH_SIZE);
        log.info("Outbox cleanup removed {} rows older than {}", total, cutoff);
    }
}
