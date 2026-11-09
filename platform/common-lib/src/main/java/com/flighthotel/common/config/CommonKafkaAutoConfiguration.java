package com.flighthotel.common.config;

import java.util.LinkedHashMap;
import java.util.Map;

import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.kafka.autoconfigure.KafkaProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaOperations;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.CommonErrorHandler;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.kafka.listener.RecordInterceptor;
import org.springframework.kafka.support.serializer.DeserializationException;
import org.springframework.util.backoff.ExponentialBackOff;

import com.flighthotel.common.kafka.CorrelationIdRecordInterceptor;
import com.flighthotel.common.settings.SystemSettings;
import com.flighthotel.common.settings.SystemSettingsListener;

import io.confluent.kafka.serializers.AbstractKafkaSchemaSerDeConfig;
import io.confluent.kafka.serializers.KafkaAvroSerializer;
import io.confluent.kafka.serializers.subject.TopicRecordNameStrategy;

/**
 * Consumer side of the event pipeline: retries with exponential backoff, then a dead-letter topic
 * ({@code <topic>.DLT}) so a broken message never blocks a partition and is never silently lost.
 * Also feeds the {@link SystemSettings} cache.
 * <p>
 * Business events are produced through the outbox only; the Kafka producers here are used for dead letters.
 */
@AutoConfiguration(afterName = "org.springframework.boot.kafka.autoconfigure.KafkaAutoConfiguration")
@EnableConfigurationProperties(CommonProperties.class)
public class CommonKafkaAutoConfiguration {

    private static final Logger log = LoggerFactory.getLogger(CommonKafkaAutoConfiguration.class);

    @Bean
    @ConditionalOnMissingBean(CommonErrorHandler.class)
    public CommonErrorHandler kafkaErrorHandler(KafkaProperties kafkaProperties, CommonProperties properties) {
        Map<String, Object> producerConfig = new LinkedHashMap<>(kafkaProperties.buildProducerProperties());
        producerConfig.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        producerConfig.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        producerConfig.put(ProducerConfig.ACKS_CONFIG, "all");

        // Raw bytes: used when a message could not even be deserialized.
        Map<String, Object> bytesConfig = new LinkedHashMap<>(producerConfig);
        bytesConfig.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        KafkaTemplate<Object, Object> bytesTemplate = new KafkaTemplate<>(new DefaultKafkaProducerFactory<>(bytesConfig));

        // Avro: used for messages that were deserialized but failed in business code.
        Map<String, Object> avroConfig = new LinkedHashMap<>(producerConfig);
        avroConfig.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, KafkaAvroSerializer.class);
        avroConfig.put(AbstractKafkaSchemaSerDeConfig.SCHEMA_REGISTRY_URL_CONFIG, properties.kafka().schemaRegistryUrl());
        avroConfig.put(AbstractKafkaSchemaSerDeConfig.AUTO_REGISTER_SCHEMAS, properties.kafka().autoRegisterSchemas());
        avroConfig.put(AbstractKafkaSchemaSerDeConfig.VALUE_SUBJECT_NAME_STRATEGY, TopicRecordNameStrategy.class.getName());
        KafkaTemplate<Object, Object> avroTemplate = new KafkaTemplate<>(new DefaultKafkaProducerFactory<>(avroConfig));

        Map<Class<?>, KafkaOperations<?, ?>> templates = new LinkedHashMap<>();
        templates.put(byte[].class, bytesTemplate);
        templates.put(Object.class, avroTemplate);

        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(templates,
                (record, ex) -> {
                    log.error("Sending message to dead-letter topic: topic={} partition={} offset={} error={}",
                            record.topic(), record.partition(), record.offset(), ex.toString());
                    return new TopicPartition(record.topic() + ".DLT", -1);
                });

        ExponentialBackOff backOff = new ExponentialBackOff(properties.kafka().retryBackoff().toMillis(), 2.0);
        backOff.setMaxAttempts(properties.kafka().maxRetries());

        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, backOff);
        // Retrying cannot fix these; send them to the DLT straight away.
        handler.addNotRetryableExceptions(DeserializationException.class, IllegalArgumentException.class,
                ClassCastException.class);
        return handler;
    }

    @Bean
    @ConditionalOnMissingBean(RecordInterceptor.class)
    public RecordInterceptor<Object, Object> correlationIdRecordInterceptor() {
        return new CorrelationIdRecordInterceptor();
    }

    @Bean
    @ConditionalOnMissingBean
    public SystemSettings systemSettings() {
        return new SystemSettings();
    }

    @Bean
    @ConditionalOnMissingBean
    public SystemSettingsListener systemSettingsListener(SystemSettings systemSettings) {
        return new SystemSettingsListener(systemSettings);
    }
}
