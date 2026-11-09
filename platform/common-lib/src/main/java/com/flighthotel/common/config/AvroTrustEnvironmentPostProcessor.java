package com.flighthotel.common.config;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;

import com.flighthotel.events.TrustedEventClasses;

/** Runs before any bean exists, so Kafka consumers and the outbox serializer can use our Avro event classes. */
public class AvroTrustEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        TrustedEventClasses.register();
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
