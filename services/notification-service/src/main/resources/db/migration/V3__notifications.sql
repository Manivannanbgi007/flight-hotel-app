-- In-app notifications (the bell). One row per notification; the source event id keeps a re-delivered Kafka event
-- from creating a second one. Preferences and the full notification center arrive in Phase 8.
CREATE TABLE notifications (
    id              BINARY(16)   NOT NULL,
    user_id         BINARY(16)   NOT NULL,
    category        VARCHAR(20)  NOT NULL COMMENT 'BOOKING, PAYMENT, REFUND',
    title           VARCHAR(150) NOT NULL,
    message         VARCHAR(500) NOT NULL,
    link            VARCHAR(200) NULL COMMENT 'path inside the web app, e.g. /trips/<id>',
    source_event_id CHAR(36)     NOT NULL,
    read_at         DATETIME(6)  NULL,
    created_at      DATETIME(6)  NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_notifications_source_event (source_event_id),
    KEY idx_notifications_user (user_id, read_at, created_at)
) ENGINE = InnoDB;
