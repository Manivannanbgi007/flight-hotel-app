package com.flighthotel.reporting.export;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(ExportProperties.class)
class ExportConfig {
}
