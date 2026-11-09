-- Payments, refunds, webhook log and invoices (DATABASE_DESIGN.md §6).
-- No card number, CVV, UPI PIN or other payment instrument data is ever stored here.

-- What payment-service knows about a booking: a projection of booking-service's events. The amount to charge comes
-- from here, never from the browser.
CREATE TABLE payable_bookings (
    booking_id        BINARY(16)     NOT NULL,
    booking_reference VARCHAR(12)    NOT NULL,
    user_id           BINARY(16)     NOT NULL,
    amount            DECIMAL(12, 2) NOT NULL,
    currency          CHAR(3)        NOT NULL,
    description       VARCHAR(255)   NOT NULL,
    contact_email     VARCHAR(254)   NOT NULL,
    status            VARCHAR(20)    NOT NULL COMMENT 'AWAITING_PAYMENT, PAID, EXPIRED, CANCELLED',
    payment_deadline  DATETIME(6)    NOT NULL COMMENT 'no new payment orders after this moment',
    created_at        DATETIME(6)    NOT NULL,
    updated_at        DATETIME(6)    NOT NULL,
    created_by        VARCHAR(64)    NOT NULL,
    updated_by        VARCHAR(64)    NOT NULL,
    version           BIGINT         NOT NULL DEFAULT 0,
    PRIMARY KEY (booking_id),
    UNIQUE KEY uk_payable_bookings_reference (booking_reference),
    KEY idx_payable_bookings_user (user_id)
) ENGINE = InnoDB;

-- One row per payment attempt. A booking has at most one open (INITIATED/PENDING) attempt at a time.
CREATE TABLE payment_transactions (
    id                  BINARY(16)     NOT NULL,
    booking_id          BINARY(16)     NOT NULL,
    user_id             BINARY(16)     NOT NULL,
    provider            VARCHAR(10)    NOT NULL COMMENT 'RAZORPAY, DEMO',
    provider_order_id   VARCHAR(64)    NOT NULL,
    provider_payment_id VARCHAR(64)    NULL,
    amount              DECIMAL(12, 2) NOT NULL,
    refunded_amount     DECIMAL(12, 2) NOT NULL DEFAULT 0,
    currency            CHAR(3)        NOT NULL,
    status              VARCHAR(20)    NOT NULL COMMENT 'INITIATED, PENDING, SUCCESS, FAILED, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED',
    method              VARCHAR(20)    NULL COMMENT 'card, upi, netbanking, ... never instrument details',
    failure_code        VARCHAR(40)    NULL,
    failure_message     VARCHAR(255)   NULL,
    idempotency_key     VARCHAR(100)   NOT NULL,
    verified_at         DATETIME(6)    NULL,
    created_at          DATETIME(6)    NOT NULL,
    updated_at          DATETIME(6)    NOT NULL,
    created_by          VARCHAR(64)    NOT NULL,
    updated_by          VARCHAR(64)    NOT NULL,
    version             BIGINT         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_payment_transactions_order (provider_order_id),
    UNIQUE KEY uk_payment_transactions_payment (provider_payment_id),
    UNIQUE KEY uk_payment_transactions_idempotency (user_id, idempotency_key),
    KEY idx_payment_transactions_booking (booking_id, created_at),
    KEY idx_payment_transactions_user (user_id, created_at),
    KEY idx_payment_transactions_status (status, created_at)
) ENGINE = InnoDB;

-- Every signed webhook we accepted. The unique event id makes a repeated delivery harmless. Only a small, sanitized
-- summary is kept (ids, amounts, status), not the provider's full payload (it contains e-mail and phone number).
CREATE TABLE payment_webhook_events (
    id                BINARY(16)   NOT NULL,
    provider          VARCHAR(10)  NOT NULL,
    provider_event_id VARCHAR(100) NOT NULL,
    event_type        VARCHAR(50)  NOT NULL,
    summary           JSON         NULL,
    processing_status VARCHAR(20)  NOT NULL COMMENT 'RECEIVED, PROCESSED, IGNORED, FAILED',
    received_at       DATETIME(6)  NOT NULL,
    processed_at      DATETIME(6)  NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_payment_webhook_events_event (provider, provider_event_id),
    KEY idx_payment_webhook_events_received (received_at)
) ENGINE = InnoDB;

CREATE TABLE refunds (
    id                 BINARY(16)     NOT NULL,
    payment_id         BINARY(16)     NOT NULL,
    booking_id         BINARY(16)     NOT NULL,
    user_id            BINARY(16)     NOT NULL,
    amount             DECIMAL(12, 2) NOT NULL,
    currency           CHAR(3)        NOT NULL,
    status             VARCHAR(20)    NOT NULL COMMENT 'PENDING, PROCESSED, FAILED',
    provider_refund_id VARCHAR(64)    NULL,
    reason             VARCHAR(30)    NOT NULL,
    failure_reason     VARCHAR(255)   NULL,
    idempotency_key    VARCHAR(64)    NOT NULL COMMENT 'booking-service refundRequestId: one request is refunded once',
    created_at         DATETIME(6)    NOT NULL,
    updated_at         DATETIME(6)    NOT NULL,
    created_by         VARCHAR(64)    NOT NULL,
    updated_by         VARCHAR(64)    NOT NULL,
    version            BIGINT         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_refunds_idempotency (idempotency_key),
    UNIQUE KEY uk_refunds_provider_refund (provider_refund_id),
    KEY idx_refunds_payment (payment_id),
    KEY idx_refunds_status (status, created_at),
    CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payment_transactions (id)
) ENGINE = InnoDB;

CREATE TABLE invoices (
    id             BINARY(16)     NOT NULL,
    invoice_number VARCHAR(30)    NOT NULL COMMENT 'INV/2026-27/000123, no gaps',
    booking_id     BINARY(16)     NOT NULL,
    booking_reference VARCHAR(12) NOT NULL,
    payment_id     BINARY(16)     NOT NULL,
    user_id        BINARY(16)     NOT NULL,
    billing_name   VARCHAR(150)   NOT NULL,
    billing_email  VARCHAR(254)   NOT NULL,
    description    VARCHAR(255)   NOT NULL,
    currency       CHAR(3)        NOT NULL,
    taxable_amount DECIMAL(12, 2) NOT NULL,
    tax_amount     DECIMAL(12, 2) NOT NULL,
    discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total_amount   DECIMAL(12, 2) NOT NULL,
    issued_at      DATETIME(6)    NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_invoices_number (invoice_number),
    UNIQUE KEY uk_invoices_booking (booking_id),
    KEY idx_invoices_user (user_id, issued_at),
    CONSTRAINT fk_invoices_payment FOREIGN KEY (payment_id) REFERENCES payment_transactions (id)
) ENGINE = InnoDB;

-- Gap-free invoice numbers: the row of the financial year is locked (SELECT ... FOR UPDATE) while a number is taken.
CREATE TABLE invoice_sequences (
    financial_year VARCHAR(7) NOT NULL COMMENT '2026-27',
    last_number    INT        NOT NULL,
    PRIMARY KEY (financial_year)
) ENGINE = InnoDB;
