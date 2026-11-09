package com.flighthotel.notification.realtime;

import java.nio.charset.StandardCharsets;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;

import com.flighthotel.common.realtime.RealtimeEnvelope;

import tools.jackson.databind.json.JsonMapper;

/** Receives realtime envelopes published by any service (via {@code RealtimePublisher}) and hands them to the hub. */
public class RealtimeRedisSubscriber implements MessageListener {

    private static final Logger log = LoggerFactory.getLogger(RealtimeRedisSubscriber.class);

    private final RealtimeHub hub;
    private final JsonMapper jsonMapper;

    public RealtimeRedisSubscriber(RealtimeHub hub, JsonMapper jsonMapper) {
        this.hub = hub;
        this.jsonMapper = jsonMapper;
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            RealtimeEnvelope envelope = jsonMapper.readValue(
                    new String(message.getBody(), StandardCharsets.UTF_8), RealtimeEnvelope.class);
            hub.deliver(envelope);
        } catch (RuntimeException ex) {
            // A bad message must never stop the subscriber.
            log.warn("Ignoring invalid realtime message: {}", ex.toString());
        }
    }
}
