package com.flighthotel.common.config;

import java.time.Clock;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.data.domain.AuditorAware;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.EnableScheduling;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.inbox.ProcessedEventStore;
import com.flighthotel.common.outbox.AvroPayloadSerializer;
import com.flighthotel.common.outbox.JdbcOutboxEventPublisher;
import com.flighthotel.common.outbox.OutboxCleanupJob;
import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.common.persistence.SecurityAuditorAware;

import jakarta.persistence.EntityManagerFactory;

/** Outbox, inbox, JPA auditing and scheduling for services with a database. */
@AutoConfiguration(afterName = {
        "org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration",
        "org.springframework.boot.hibernate.autoconfigure.HibernateJpaAutoConfiguration"
})
@ConditionalOnBean(EntityManagerFactory.class)
@EnableConfigurationProperties(CommonProperties.class)
@EnableJpaAuditing(auditorAwareRef = "auditorAware", dateTimeProviderRef = "auditingDateTimeProvider")
@EnableScheduling
public class CommonPersistenceAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(name = "auditorAware")
    public AuditorAware<String> auditorAware() {
        return new SecurityAuditorAware();
    }

    @Bean
    @ConditionalOnMissingBean(name = "auditingDateTimeProvider")
    public org.springframework.data.auditing.DateTimeProvider auditingDateTimeProvider(Clock clock) {
        return () -> java.util.Optional.of(clock.instant());
    }

    @Bean(destroyMethod = "close")
    @ConditionalOnMissingBean
    public AvroPayloadSerializer avroPayloadSerializer(CommonProperties properties) {
        return new AvroPayloadSerializer(properties.kafka().schemaRegistryUrl(), properties.kafka().autoRegisterSchemas());
    }

    @Bean
    @ConditionalOnMissingBean
    public OutboxEventPublisher outboxEventPublisher(JdbcClient jdbcClient, AvroPayloadSerializer serializer,
            Clock clock) {
        return new JdbcOutboxEventPublisher(jdbcClient, serializer, clock);
    }

    @Bean
    @ConditionalOnMissingBean
    public ProcessedEventStore processedEventStore(JdbcClient jdbcClient, Clock clock) {
        return new ProcessedEventStore(jdbcClient, clock);
    }

    @Bean
    @ConditionalOnMissingBean
    public AuditPublisher auditPublisher(OutboxEventPublisher outbox,
            @Value("${spring.application.name}") String serviceName) {
        return new AuditPublisher(outbox, serviceName);
    }

    @Bean
    @ConditionalOnMissingBean
    public OutboxCleanupJob outboxCleanupJob(JdbcClient jdbcClient, CommonProperties properties, Clock clock) {
        return new OutboxCleanupJob(jdbcClient, properties.outbox().retention(), clock);
    }
}
