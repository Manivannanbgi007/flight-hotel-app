package com.flighthotel.reporting.audit;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.audit.AuditEventRecorded;

/** Keeps every service's audit events ({@code audit.events}); a redelivered event is stored once. */
@Component
public class AuditEventsListener {

    static final String CONSUMER = "reporting-audit";
    private static final Logger log = LoggerFactory.getLogger(AuditEventsListener.class);

    private final AuditLogStore store;

    public AuditEventsListener(AuditLogStore store) {
        this.store = store;
    }

    @KafkaListener(id = CONSUMER, groupId = CONSUMER, topics = "audit.events")
    public void onAuditEvent(ConsumerRecord<String, Object> record) {
        handle(EventHeaders.eventId(record), record.value());
    }

    /** Also called directly by tests. */
    public void handle(String eventId, Object event) {
        if (event instanceof AuditEventRecorded audit && !store.store(eventId, audit)) {
            log.info("Audit event already stored eventId={}", eventId);
        }
    }
}
