-- Phase 8: PDF documents, notification preferences, the projections for documents and travel reminders,
-- customer support tickets and the newsletter (DATABASE_DESIGN.md section 7).

ALTER TABLE notifications
    MODIFY category VARCHAR(20) NOT NULL COMMENT 'ACCOUNT, BOOKING, PAYMENT, REFUND, REMINDER, SUPPORT',
    MODIFY source_event_id VARCHAR(64) NOT NULL COMMENT 'event id, or a key derived from it (one notification each)',
    ADD KEY idx_notifications_user_category (user_id, category, created_at);

-- One PDF per (type, source): the id is derived from them, so a retried event overwrites the same file and row.
CREATE TABLE documents (
    id              BINARY(16)   NOT NULL COMMENT 'UUID derived from document_type + reference_id',
    booking_id      BINARY(16)   NOT NULL,
    user_id         BINARY(16)   NOT NULL,
    document_type   VARCHAR(30)  NOT NULL COMMENT 'BOOKING_CONFIRMATION, E_TICKET, INVOICE, PAYMENT_RECEIPT, CANCELLATION_CONFIRMATION, REFUND_RECEIPT',
    reference_id    VARCHAR(64)  NOT NULL COMMENT 'booking, invoice, payment, cancellation or refund id',
    title           VARCHAR(120) NOT NULL,
    file_name       VARCHAR(120) NOT NULL,
    storage_key     VARCHAR(120) NOT NULL COMMENT 'FileStorage key: never a public URL',
    content_type    VARCHAR(50)  NOT NULL,
    size_bytes      INT          NOT NULL,
    sha256          CHAR(64)     NOT NULL,
    created_at      DATETIME(6)  NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_documents_source (document_type, reference_id),
    KEY idx_documents_booking (booking_id, created_at),
    KEY idx_documents_user (user_id, created_at)
) ENGINE = InnoDB;

-- Only the choices a customer changed are stored; everything else is on (and locked items are always on).
CREATE TABLE notification_preferences (
    user_id    BINARY(16)  NOT NULL,
    category   VARCHAR(20) NOT NULL COMMENT 'BOOKING, PAYMENT, REFUND, REMINDER, SUPPORT',
    channel    VARCHAR(10) NOT NULL COMMENT 'EMAIL, IN_APP',
    enabled    BOOLEAN     NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (user_id, category, channel)
) ENGINE = InnoDB;

-- Projection of booking events: who a booking belongs to and how to address the customer (receipts, payment and
-- refund e-mails, support tickets about a booking).
CREATE TABLE booking_contacts (
    booking_id        BINARY(16)   NOT NULL,
    user_id           BINARY(16)   NOT NULL,
    booking_reference VARCHAR(12)  NOT NULL,
    booking_type      VARCHAR(10)  NOT NULL,
    description       VARCHAR(255) NULL COMMENT 'e.g. Sea Breeze Resort · 2 nights · 1 room',
    contact_email     VARCHAR(254) NOT NULL,
    customer_name     VARCHAR(130) NULL COMMENT 'lead guest / first passenger, once confirmed',
    demo              BOOLEAN      NOT NULL DEFAULT FALSE,
    updated_at        DATETIME(6)  NOT NULL,
    PRIMARY KEY (booking_id),
    KEY idx_booking_contacts_user (user_id)
) ENGINE = InnoDB;

-- Projection for travel reminders: confirmed trips, when they start, and whether the reminder went out.
CREATE TABLE upcoming_trips (
    booking_id        BINARY(16)   NOT NULL,
    user_id           BINARY(16)   NOT NULL,
    booking_reference VARCHAR(12)  NOT NULL,
    booking_type      VARCHAR(10)  NOT NULL,
    title             VARCHAR(200) NOT NULL,
    contact_email     VARCHAR(254) NOT NULL,
    customer_name     VARCHAR(130) NOT NULL,
    starts_at         DATETIME(6)  NOT NULL COMMENT 'check-in moment / first departure (UTC)',
    details_json      TEXT         NOT NULL COMMENT 'label/value rows for the reminder e-mail',
    status            VARCHAR(12)  NOT NULL COMMENT 'ACTIVE, CANCELLED, COMPLETED',
    reminder_sent_at  DATETIME(6)  NULL,
    confirmed_at      DATETIME(6)  NOT NULL,
    PRIMARY KEY (booking_id),
    KEY idx_upcoming_trips_due (status, reminder_sent_at, starts_at)
) ENGINE = InnoDB;

CREATE TABLE support_tickets (
    id                BINARY(16)   NOT NULL,
    ticket_number     VARCHAR(12)  NOT NULL COMMENT 'TK-7K3M9Q2X',
    user_id           BINARY(16)   NOT NULL,
    booking_id        BINARY(16)   NULL,
    booking_reference VARCHAR(12)  NULL,
    subject           VARCHAR(120) NOT NULL,
    category          VARCHAR(20)  NOT NULL COMMENT 'BOOKING, PAYMENT, REFUND, CANCELLATION, ACCOUNT, OTHER',
    status            VARCHAR(20)  NOT NULL COMMENT 'OPEN, IN_PROGRESS, WAITING_CUSTOMER, ESCALATED, RESOLVED, CLOSED',
    priority          VARCHAR(10)  NOT NULL COMMENT 'NORMAL, HIGH',
    assigned_agent_id BINARY(16)   NULL COMMENT 'Phase 9 (agent queue)',
    source_event_id   CHAR(36)     NULL COMMENT 'tickets opened automatically: one per event',
    last_message_at   DATETIME(6)  NOT NULL,
    last_message_by   VARCHAR(20)  NOT NULL COMMENT 'CUSTOMER, SUPPORT, SYSTEM',
    closed_at         DATETIME(6)  NULL,
    created_at        DATETIME(6)  NOT NULL,
    updated_at        DATETIME(6)  NOT NULL,
    created_by        VARCHAR(64)  NOT NULL,
    updated_by        VARCHAR(64)  NOT NULL,
    version           BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_support_tickets_number (ticket_number),
    UNIQUE KEY uk_support_tickets_source_event (source_event_id),
    KEY idx_support_tickets_user (user_id, last_message_at),
    KEY idx_support_tickets_status (status, last_message_at)
) ENGINE = InnoDB;

CREATE TABLE support_ticket_messages (
    id          BINARY(16)    NOT NULL,
    ticket_id   BINARY(16)    NOT NULL,
    author_id   VARCHAR(64)   NOT NULL COMMENT 'user id or SYSTEM',
    author_role VARCHAR(20)   NOT NULL COMMENT 'CUSTOMER, SUPPORT_AGENT, ADMIN, SYSTEM',
    message     VARCHAR(2000) NOT NULL,
    created_at  DATETIME(6)   NOT NULL,
    PRIMARY KEY (id),
    KEY idx_support_ticket_messages_ticket (ticket_id, created_at),
    CONSTRAINT fk_support_ticket_messages_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets (id)
) ENGINE = InnoDB;

-- Double opt-in: PENDING until the link in the confirmation e-mail is used (only its SHA-256 is stored).
CREATE TABLE newsletter_subscriptions (
    id                 BINARY(16)   NOT NULL,
    email              VARCHAR(254) NOT NULL COMMENT 'lower case',
    status             VARCHAR(15)  NOT NULL COMMENT 'PENDING, SUBSCRIBED, UNSUBSCRIBED',
    user_id            BINARY(16)   NULL COMMENT 'set when managed from the account',
    source             VARCHAR(10)  NOT NULL COMMENT 'FORM, ACCOUNT',
    confirm_token_hash CHAR(64)     NULL,
    confirm_expires_at DATETIME(6)  NULL,
    created_at         DATETIME(6)  NOT NULL,
    confirmed_at       DATETIME(6)  NULL,
    unsubscribed_at    DATETIME(6)  NULL,
    updated_at         DATETIME(6)  NOT NULL,
    version            BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_newsletter_subscriptions_email (email),
    UNIQUE KEY uk_newsletter_subscriptions_token (confirm_token_hash)
) ENGINE = InnoDB;
