package com.flighthotel.notification.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import com.flighthotel.notification.email.EmailProperties;

@Configuration
@EnableConfigurationProperties(EmailProperties.class)
public class EmailConfig {
}
