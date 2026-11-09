package com.flighthotel.common.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

class TravelDefaultsEnvironmentPostProcessorTest {

    private final TravelDefaultsEnvironmentPostProcessor processor = new TravelDefaultsEnvironmentPostProcessor();

    @Test
    void defaultsApplyWhenServiceDoesNotSetAValue() {
        StandardEnvironment environment = new StandardEnvironment();

        processor.postProcessEnvironment(environment, new SpringApplication());

        assertThat(environment.getProperty("spring.jpa.open-in-view")).isEqualTo("false");
        assertThat(environment.getProperty("logging.structured.format.console")).isNull();
    }

    @Test
    void serviceSettingsWinOverDefaults() {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource("application.yml",
                Map.of("spring.kafka.listener.ack-mode", "batch")));

        processor.postProcessEnvironment(environment, new SpringApplication());

        assertThat(environment.getProperty("spring.kafka.listener.ack-mode")).isEqualTo("batch");
    }

    @Test
    void profileDocumentsOnlyApplyForActiveProfiles() {
        StandardEnvironment environment = new StandardEnvironment();
        environment.setActiveProfiles("prod");

        processor.postProcessEnvironment(environment, new SpringApplication());

        assertThat(environment.getProperty("logging.structured.format.console")).isEqualTo("ecs");
        assertThat(environment.getProperty("travel.kafka.auto-register-schemas")).isEqualTo("false");
    }
}
