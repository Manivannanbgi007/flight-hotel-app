package com.flighthotel.notification.realtime;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Realtime hub limits ({@code notification.realtime.*}).
 *
 * @param heartbeatInterval         keep-alive comment interval; must stay below proxy/ALB idle timeouts (60 s)
 * @param maxStreamLifetime         a stream is closed after this time at the latest (clients reconnect)
 * @param maxConnectionsPerUser     extra streams close the user's oldest one
 * @param maxConnectionsPerInstance beyond this, new streams get 503 and clients back off
 * @param queueCapacity             pending events per stream; a client that cannot keep up is disconnected
 * @param reconnectDelay            suggested client retry delay sent in the SSE {@code retry:} field
 */
@ConfigurationProperties("notification.realtime")
public record RealtimeProperties(
        @DefaultValue("25s") Duration heartbeatInterval,
        @DefaultValue("30m") Duration maxStreamLifetime,
        @DefaultValue("5") int maxConnectionsPerUser,
        @DefaultValue("10000") int maxConnectionsPerInstance,
        @DefaultValue("256") int queueCapacity,
        @DefaultValue("5s") Duration reconnectDelay) {
}
