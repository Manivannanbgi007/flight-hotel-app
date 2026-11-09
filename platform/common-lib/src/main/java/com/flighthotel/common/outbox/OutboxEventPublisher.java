package com.flighthotel.common.outbox;

import org.apache.avro.specific.SpecificRecord;

/**
 * Publishes a business event using the transactional outbox pattern.
 * <p>
 * The event is written to the {@code outbox_events} table <b>in the caller's database transaction</b>. If the
 * transaction rolls back, the event is never published. If it commits, Debezium publishes it to Kafka topic
 * {@code <aggregateType>.events} with key {@code aggregateId}.
 * <p>
 * Calling it without an active transaction is a programming error and fails immediately.
 */
public interface OutboxEventPublisher {

    /**
     * @param aggregateType the producing domain, e.g. {@code "booking"} → topic {@code booking.events}
     * @param aggregateId   Kafka message key; all events with the same key stay in order
     * @param event         an Avro event class generated from {@code event-schemas}
     * @return the event ID (also sent as Kafka header {@code id})
     */
    String publish(String aggregateType, String aggregateId, SpecificRecord event);
}
