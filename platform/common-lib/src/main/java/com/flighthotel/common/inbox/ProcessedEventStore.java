package com.flighthotel.common.inbox;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Makes Kafka consumers idempotent ("inbox" pattern). Kafka may deliver the same event more than once, for
 * example after a consumer restart.
 * <p>
 * Usage inside a {@code @Transactional} listener:
 * <pre>{@code
 * if (!processedEvents.markProcessed(EventHeaders.eventId(record), "booking-on-payment-succeeded")) {
 *     return; // already handled
 * }
 * // ... business changes, in the same transaction ...
 * }</pre>
 * Because the marker row and the business changes commit together, an event is never half-processed.
 */
public class ProcessedEventStore {

    private final JdbcClient jdbcClient;
    private final Clock clock;

    public ProcessedEventStore(JdbcClient jdbcClient, Clock clock) {
        this.jdbcClient = jdbcClient;
        this.clock = clock;
    }

    /** @return {@code true} the first time this consumer sees the event, {@code false} for a duplicate */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean markProcessed(String eventId, String consumerName) {
        int inserted = jdbcClient.sql("""
                        INSERT IGNORE INTO processed_events (event_id, consumer_name, processed_at)
                        VALUES (:eventId, :consumerName, :processedAt)
                        """)
                .param("eventId", eventId)
                .param("consumerName", consumerName)
                .param("processedAt", Timestamp.from(Instant.now(clock)))
                .update();
        return inserted == 1;
    }
}
