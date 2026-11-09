package com.flighthotel.common.kafka;

import java.nio.charset.StandardCharsets;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.header.Header;

/**
 * Reads the metadata headers Debezium's outbox router adds to every event
 * (see {@code infra/kafka-connect/connectors/*.json}).
 */
public final class EventHeaders {

    public static final String EVENT_ID = "id";
    public static final String EVENT_TYPE = "eventType";
    public static final String CORRELATION_ID = "correlationId";

    private EventHeaders() {
    }

    /** The unique event ID. Every outbox event has one; a missing ID means the message did not come from an outbox. */
    public static String eventId(ConsumerRecord<?, ?> record) {
        String id = header(record, EVENT_ID);
        if (id == null) {
            throw new IllegalArgumentException("Event without '" + EVENT_ID + "' header on " + record.topic()
                    + "-" + record.partition() + "@" + record.offset());
        }
        return id;
    }

    public static String eventType(ConsumerRecord<?, ?> record) {
        return header(record, EVENT_TYPE);
    }

    public static String correlationId(ConsumerRecord<?, ?> record) {
        return header(record, CORRELATION_ID);
    }

    public static String header(ConsumerRecord<?, ?> record, String name) {
        Header header = record.headers().lastHeader(name);
        if (header == null || header.value() == null) {
            return null;
        }
        String value = new String(header.value(), StandardCharsets.UTF_8);
        // Debezium's SimpleHeaderConverter writes strings as-is; tolerate JSON-quoted values too.
        if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
            value = value.substring(1, value.length() - 1);
        }
        return value;
    }
}
