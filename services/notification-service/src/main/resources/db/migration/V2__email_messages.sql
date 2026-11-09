-- One row per email we sent (or tried to send). The body is NOT stored: account emails contain single-use links.
CREATE TABLE email_messages (
    id              BINARY(16)   NOT NULL,
    source_event_id CHAR(36)     NOT NULL COMMENT 'outbox event that asked for this email',
    user_id         BINARY(16)   NULL,
    to_email        VARCHAR(254) NOT NULL,
    template        VARCHAR(50)  NOT NULL COMMENT 'e.g. VERIFY_EMAIL, RESET_PASSWORD',
    subject         VARCHAR(255) NOT NULL,
    status          VARCHAR(20)  NOT NULL COMMENT 'SENT, SKIPPED_EXPIRED',
    sent_at         DATETIME(6)  NULL,
    created_at      DATETIME(6)  NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_email_messages_source_event (source_event_id),
    KEY idx_email_messages_user (user_id, created_at),
    KEY idx_email_messages_created (created_at)
) ENGINE = InnoDB;
