package com.flighthotel.common.config;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.core.StringRedisTemplate;

import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.realtime.RedisRealtimePublisher;

import io.micrometer.core.instrument.MeterRegistry;
import tools.jackson.databind.json.JsonMapper;

/** Realtime (auto refresh) publishing through Redis Pub/Sub. See REALTIME_UPDATES.md. */
@AutoConfiguration(afterName = {
        "org.springframework.boot.data.redis.autoconfigure.DataRedisAutoConfiguration",
        "org.springframework.boot.jackson.autoconfigure.JacksonAutoConfiguration"
})
@EnableConfigurationProperties(CommonProperties.class)
@ConditionalOnProperty(prefix = "travel.realtime", name = "enabled", havingValue = "true", matchIfMissing = true)
public class CommonRealtimeAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public RealtimePublisher realtimePublisher(StringRedisTemplate redisTemplate, JsonMapper jsonMapper,
            CommonProperties properties, MeterRegistry meterRegistry) {
        return new RedisRealtimePublisher(redisTemplate, jsonMapper, properties.realtime().channel(), meterRegistry);
    }
}
