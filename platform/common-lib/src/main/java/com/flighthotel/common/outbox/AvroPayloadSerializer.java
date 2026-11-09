package com.flighthotel.common.outbox;

import java.util.HashMap;
import java.util.Map;

import org.apache.avro.specific.SpecificRecord;

import io.confluent.kafka.serializers.AbstractKafkaSchemaSerDeConfig;
import io.confluent.kafka.serializers.KafkaAvroSerializer;
import io.confluent.kafka.serializers.subject.TopicRecordNameStrategy;

/**
 * Serializes events to the Confluent Avro wire format (magic byte + schema id + Avro binary), registering the
 * schema in Schema Registry.
 * <p>
 * The bytes are stored in the outbox table and Debezium copies them to Kafka unchanged, so consumers can read
 * them with the normal {@code KafkaAvroDeserializer}.
 * <p>
 * Subject naming uses {@link TopicRecordNameStrategy} ({@code <topic>-<record full name>}), so one topic can carry
 * several event types for the same aggregate while keeping per-key ordering.
 */
public class AvroPayloadSerializer implements AutoCloseable {

    private final KafkaAvroSerializer delegate;

    public AvroPayloadSerializer(String schemaRegistryUrl, boolean autoRegisterSchemas) {
        Map<String, Object> config = new HashMap<>();
        config.put(AbstractKafkaSchemaSerDeConfig.SCHEMA_REGISTRY_URL_CONFIG, schemaRegistryUrl);
        config.put(AbstractKafkaSchemaSerDeConfig.AUTO_REGISTER_SCHEMAS, autoRegisterSchemas);
        config.put(AbstractKafkaSchemaSerDeConfig.VALUE_SUBJECT_NAME_STRATEGY, TopicRecordNameStrategy.class.getName());
        this.delegate = new KafkaAvroSerializer();
        this.delegate.configure(config, false);
    }

    public byte[] serialize(String topic, SpecificRecord event) {
        return delegate.serialize(topic, event);
    }

    @Override
    public void close() {
        delegate.close();
    }
}
