-- Transactional outbox: rows are published to Kafka by Debezium (see infra/kafka-connect/connectors).
CREATE TABLE outbox_events (
    id             CHAR(36)     NOT NULL,
    aggregate_type VARCHAR(64)  NOT NULL COMMENT 'routes to topic <aggregate_type>.events',
    aggregate_id   VARCHAR(64)  NOT NULL COMMENT 'Kafka message key',
    event_type     VARCHAR(255) NOT NULL COMMENT 'Avro record full name',
    payload        MEDIUMBLOB   NOT NULL COMMENT 'Confluent Avro wire format',
    correlation_id VARCHAR(64)  NULL,
    created_at     DATETIME(6)  NOT NULL,
    PRIMARY KEY (id),
    KEY idx_outbox_events_created_at (created_at)
) ENGINE = InnoDB;

-- Idempotent consumers: one row per (event, consumer) that has been handled.
CREATE TABLE processed_events (
    event_id      CHAR(36)     NOT NULL,
    consumer_name VARCHAR(100) NOT NULL,
    processed_at  DATETIME(6)  NOT NULL,
    PRIMARY KEY (event_id, consumer_name),
    KEY idx_processed_events_processed_at (processed_at)
) ENGINE = InnoDB;
