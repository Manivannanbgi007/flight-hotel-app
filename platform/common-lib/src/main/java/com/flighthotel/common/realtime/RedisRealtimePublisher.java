package com.flighthotel.common.realtime;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import tools.jackson.databind.json.JsonMapper;

/** Publishes realtime envelopes as JSON to a Redis Pub/Sub channel. */
public class RedisRealtimePublisher implements RealtimePublisher {

    private static final Logger log = LoggerFactory.getLogger(RedisRealtimePublisher.class);

    private final StringRedisTemplate redis;
    private final JsonMapper jsonMapper;
    private final String channel;
    private final Counter published;
    private final Counter failed;

    public RedisRealtimePublisher(StringRedisTemplate redis, JsonMapper jsonMapper, String channel,
            MeterRegistry meterRegistry) {
        this.redis = redis;
        this.jsonMapper = jsonMapper;
        this.channel = channel;
        this.published = Counter.builder("realtime.publish").tag("outcome", "success").register(meterRegistry);
        this.failed = Counter.builder("realtime.publish").tag("outcome", "failure").register(meterRegistry);
    }

    @Override
    public void publish(RealtimeMessage message, RealtimeAudience audience) {
        RealtimeEnvelope envelope = new RealtimeEnvelope(message, audience);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    send(envelope);
                }
            });
        } else {
            send(envelope);
        }
    }

    private void send(RealtimeEnvelope envelope) {
        try {
            redis.convertAndSend(channel, jsonMapper.writeValueAsString(envelope));
            published.increment();
        } catch (RuntimeException ex) {
            failed.increment();
            log.warn("Realtime message not published: type={} resourceId={} error={}",
                    envelope.message().type(), envelope.message().resourceId(), ex.toString());
        }
    }
}
