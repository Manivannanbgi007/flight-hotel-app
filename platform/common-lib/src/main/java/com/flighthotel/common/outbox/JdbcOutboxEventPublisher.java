package com.flighthotel.common.outbox;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.regex.Pattern;

import org.apache.avro.specific.SpecificRecord;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.correlation.CorrelationId;
import com.flighthotel.common.id.UuidV7;

/** Writes outbox rows with plain JDBC so it joins the caller's JPA transaction without needing an entity. */
public class JdbcOutboxEventPublisher implements OutboxEventPublisher {

    private static final Pattern AGGREGATE_TYPE = Pattern.compile("^[a-z][a-z0-9-]{1,40}$");

    private final JdbcClient jdbcClient;
    private final AvroPayloadSerializer serializer;
    private final Clock clock;

    public JdbcOutboxEventPublisher(JdbcClient jdbcClient, AvroPayloadSerializer serializer, Clock clock) {
        this.jdbcClient = jdbcClient;
        this.serializer = serializer;
        this.clock = clock;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public String publish(String aggregateType, String aggregateId, SpecificRecord event) {
        if (!AGGREGATE_TYPE.matcher(aggregateType).matches()) {
            throw new IllegalArgumentException("Invalid aggregate type: " + aggregateType);
        }
        if (aggregateId == null || aggregateId.isBlank()) {
            throw new IllegalArgumentException("aggregateId is required");
        }
        String topic = topicFor(aggregateType);
        String eventId = UuidV7.generate().toString();
        byte[] payload = serializer.serialize(topic, event);

        jdbcClient.sql("""
                        INSERT INTO outbox_events
                            (id, aggregate_type, aggregate_id, event_type, payload, correlation_id, created_at)
                        VALUES (:id, :aggregateType, :aggregateId, :eventType, :payload, :correlationId, :createdAt)
                        """)
                .param("id", eventId)
                .param("aggregateType", aggregateType)
                .param("aggregateId", aggregateId)
                .param("eventType", event.getSchema().getFullName())
                .param("payload", payload)
                .param("correlationId", CorrelationId.current())
                .param("createdAt", Timestamp.from(Instant.now(clock)))
                .update();
        return eventId;
    }

    /** Must match the Debezium EventRouter setting {@code route.topic.replacement=${routedByValue}.events}. */
    public static String topicFor(String aggregateType) {
        return aggregateType + ".events";
    }
}
