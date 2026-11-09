package com.flighthotel.common.kafka;

import org.apache.kafka.clients.consumer.Consumer;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.MDC;
import org.springframework.kafka.listener.RecordInterceptor;

import com.flighthotel.common.correlation.CorrelationId;

/**
 * Puts the event's correlation ID into the logging MDC while a Kafka listener processes it, so log lines from
 * the consumer can be matched with the original user request. New outbox events written by the listener also
 * inherit it.
 */
public class CorrelationIdRecordInterceptor implements RecordInterceptor<Object, Object> {

    @Override
    public ConsumerRecord<Object, Object> intercept(ConsumerRecord<Object, Object> record,
            Consumer<Object, Object> consumer) {
        MDC.put(CorrelationId.MDC_KEY, CorrelationId.sanitizeOrCreate(EventHeaders.correlationId(record)));
        return record;
    }

    @Override
    public void afterRecord(ConsumerRecord<Object, Object> record, Consumer<Object, Object> consumer) {
        MDC.remove(CorrelationId.MDC_KEY);
    }
}
