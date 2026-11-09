package com.flighthotel.flight.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(FlightProperties.class)
public class FlightConfig {
}
