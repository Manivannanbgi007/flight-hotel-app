package com.flighthotel.notification.realtime;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.realtime.RealtimeEnvelope;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.security.AuthenticatedUser;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import tools.jackson.databind.json.JsonMapper;

/**
 * Heart of the auto-refresh feature on the server: opens SSE streams, delivers messages received from Redis to
 * the right streams, sends heartbeats and closes streams whose access token expired.
 * <p>
 * On shutdown it tells every client to reconnect (to another instance) instead of letting streams hang.
 */
public class RealtimeHub implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(RealtimeHub.class);

    private final RealtimeConnectionRegistry registry;
    private final RealtimeProperties properties;
    private final JsonMapper jsonMapper;
    private final Clock clock;
    private final ExecutorService writers = Executors.newThreadPerTaskExecutor(
            Thread.ofVirtual().name("realtime-writer-", 0).factory());
    private final Counter delivered;
    private final Counter dropped;
    private volatile boolean running;

    public RealtimeHub(RealtimeConnectionRegistry registry, RealtimeProperties properties, JsonMapper jsonMapper,
            Clock clock, MeterRegistry meterRegistry) {
        this.registry = registry;
        this.properties = properties;
        this.jsonMapper = jsonMapper;
        this.clock = clock;
        this.delivered = Counter.builder("realtime.messages.delivered").register(meterRegistry);
        this.dropped = Counter.builder("realtime.messages.dropped").register(meterRegistry);
        Gauge.builder("realtime.connections.active", registry, RealtimeConnectionRegistry::size).register(meterRegistry);
    }

    /** Opens a stream for an authenticated user. */
    public SseEmitter open(AuthenticatedUser user) {
        Instant now = clock.instant();
        Instant tokenExpiresAt = user.tokenExpiresAt() != null ? user.tokenExpiresAt() : now.plus(properties.maxStreamLifetime());
        // Safety net: the emitter times out shortly after the token expires or the max lifetime is reached.
        Duration lifetime = Duration.between(now, tokenExpiresAt).plusSeconds(30);
        if (lifetime.compareTo(properties.maxStreamLifetime()) > 0) {
            lifetime = properties.maxStreamLifetime();
        }
        SseEmitter emitter = new SseEmitter(Math.max(lifetime.toMillis(), 1_000L));

        RealtimeConnection connection = new RealtimeConnection(UuidV7.generate().toString(), user.id().toString(),
                user.roles(), now, tokenExpiresAt, emitter, properties.queueCapacity());
        registry.register(connection);

        connection.send(SseEmitter.event()
                .reconnectTime(properties.reconnectDelay().toMillis())
                .name("connected")
                .data(json(Map.of(
                        "connectionId", connection.id(),
                        "serverTime", now.toString(),
                        "tokenExpiresAt", tokenExpiresAt.toString())), MediaType.APPLICATION_JSON));
        writers.execute(connection::runWriter);
        log.debug("Realtime stream opened connectionId={} userId={}", connection.id(), connection.userId());
        return emitter;
    }

    /** Called for every message from Redis Pub/Sub. Never blocks: it only queues events. */
    public void deliver(RealtimeEnvelope envelope) {
        RealtimeMessage message = envelope.message();
        String payload = json(message);
        for (RealtimeConnection connection : registry.connectionsFor(envelope.audience())) {
            boolean queued = connection.send(SseEmitter.event()
                    .id(message.id())
                    .name("message")
                    .data(payload, MediaType.APPLICATION_JSON));
            if (queued) {
                delivered.increment();
            } else {
                dropped.increment();
            }
        }
    }

    /** Keeps idle streams alive and closes streams whose access token has expired. */
    public void heartbeat() {
        Instant now = clock.instant();
        for (RealtimeConnection connection : registry.all()) {
            if (!now.isBefore(connection.tokenExpiresAt())) {
                connection.close(SseEmitter.event().name("token-expired").data("{}", MediaType.APPLICATION_JSON));
            } else {
                connection.send(SseEmitter.event().comment("ping"));
            }
        }
    }

    public int openConnections() {
        return registry.size();
    }

    private String json(Object value) {
        return jsonMapper.writeValueAsString(value);
    }

    @Override
    public void start() {
        running = true;
    }

    @Override
    public void stop() {
        running = false;
        int count = registry.size();
        for (RealtimeConnection connection : registry.all()) {
            connection.close(SseEmitter.event().name("reconnect").data("{}", MediaType.APPLICATION_JSON));
        }
        writers.shutdown();
        try {
            if (!writers.awaitTermination(5, TimeUnit.SECONDS)) {
                writers.shutdownNow();
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
        log.info("Realtime hub stopped; asked {} clients to reconnect", count);
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    /** Stop before the web server's graceful shutdown, which would otherwise wait for open streams. */
    @Override
    public int getPhase() {
        return SmartLifecycle.DEFAULT_PHASE;
    }
}
