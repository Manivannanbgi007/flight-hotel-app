package com.flighthotel.notification.config;

import java.time.Clock;
import java.util.concurrent.Executors;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import com.flighthotel.common.config.CommonProperties;
import com.flighthotel.notification.realtime.RealtimeConnectionRegistry;
import com.flighthotel.notification.realtime.RealtimeHeartbeatScheduler;
import com.flighthotel.notification.realtime.RealtimeHub;
import com.flighthotel.notification.realtime.RealtimeProperties;
import com.flighthotel.notification.realtime.RealtimeRedisSubscriber;

import io.micrometer.core.instrument.MeterRegistry;
import tools.jackson.databind.json.JsonMapper;

/** Wires the realtime hub: Redis Pub/Sub in, SSE streams out. See REALTIME_UPDATES.md. */
@Configuration
@EnableConfigurationProperties(RealtimeProperties.class)
public class RealtimeConfig {

    @Bean
    RealtimeConnectionRegistry realtimeConnectionRegistry(RealtimeProperties properties) {
        return new RealtimeConnectionRegistry(properties.maxConnectionsPerUser(), properties.maxConnectionsPerInstance());
    }

    @Bean
    RealtimeHub realtimeHub(RealtimeConnectionRegistry registry, RealtimeProperties properties, JsonMapper jsonMapper,
            Clock clock, MeterRegistry meterRegistry) {
        return new RealtimeHub(registry, properties, jsonMapper, clock, meterRegistry);
    }

    @Bean
    RealtimeHeartbeatScheduler realtimeHeartbeatScheduler(RealtimeHub hub) {
        return new RealtimeHeartbeatScheduler(hub);
    }

    @Bean
    RedisMessageListenerContainer realtimeListenerContainer(RedisConnectionFactory connectionFactory,
            RealtimeHub hub, JsonMapper jsonMapper, CommonProperties commonProperties) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        // One dispatch thread keeps messages in publish order; delivery itself only queues events, so it is fast.
        container.setTaskExecutor(Executors.newSingleThreadExecutor(Thread.ofPlatform().name("realtime-dispatch").factory()));
        container.addMessageListener(new RealtimeRedisSubscriber(hub, jsonMapper),
                new ChannelTopic(commonProperties.realtime().channel()));
        return container;
    }
}
