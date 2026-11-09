-- Phase 7: the audit trail. Every service publishes AuditEventRecorded to audit.events (outbox -> Debezium -> Kafka);
-- reporting-service keeps them here for the admin "Audit logs" page (API_DOCUMENTATION.md section 11).
-- details never contain personal data or secrets (the publishers' rule); one row per event (source_event_id).

CREATE TABLE audit_logs (
    id              BINARY(16)    NOT NULL,
    source_event_id CHAR(36)      NOT NULL COMMENT 'the outbox event id: a redelivered event is stored once',
    service         VARCHAR(40)   NOT NULL,
    actor_id        VARCHAR(64)   NOT NULL COMMENT 'user id or SYSTEM',
    actor_roles     VARCHAR(200)  NULL COMMENT 'comma separated',
    action          VARCHAR(60)   NOT NULL,
    entity_type     VARCHAR(40)   NOT NULL,
    entity_id       VARCHAR(64)   NOT NULL,
    details         JSON          NULL,
    ip_address      VARCHAR(45)   NULL,
    correlation_id  VARCHAR(64)   NULL,
    occurred_at     DATETIME(6)   NOT NULL,
    received_at     DATETIME(6)   NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_audit_logs_event (source_event_id),
    KEY idx_audit_logs_occurred (occurred_at),
    KEY idx_audit_logs_entity (entity_type, entity_id, occurred_at),
    KEY idx_audit_logs_action (action, occurred_at),
    KEY idx_audit_logs_actor (actor_id, occurred_at)
) ENGINE = InnoDB;
