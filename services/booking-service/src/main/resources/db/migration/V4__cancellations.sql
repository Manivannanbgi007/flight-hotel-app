-- Phase 7: cancellations, refunds and the support "Needs attention" queue (BOOKING_WORKFLOW.md section 4).

ALTER TABLE bookings
    MODIFY payment_status VARCHAR(20) NOT NULL COMMENT 'UNPAID, PAYMENT_FAILED, PAID, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED',
    ADD COLUMN refunded_amount  DECIMAL(12, 2) NOT NULL DEFAULT 0 COMMENT 'sum of completed refunds of the booking' AFTER total_amount,
    ADD COLUMN cancel_until     DATETIME(6)    NULL COMMENT 'last moment to cancel: check-in / first departure - 4 h' AFTER payment_deadline,
    ADD COLUMN cancelled_at     DATETIME(6)    NULL AFTER confirmed_at,
    ADD COLUMN attention_reason VARCHAR(30)    NULL COMMENT 'support queue: REFUND_FAILED, CANCELLATION_REJECTED, ...' AFTER failure_message,
    ADD COLUMN attention_note   VARCHAR(500)   NULL COMMENT 'internal, never shown to the customer' AFTER attention_reason,
    ADD COLUMN attention_since  DATETIME(6)    NULL AFTER attention_note,
    ADD KEY idx_bookings_attention (attention_reason, attention_since),
    ADD KEY idx_bookings_contact_email (contact_email);

-- Bookings held before this migration: the deadline from the stored stay / flights, in India time (UTC+5:30), which
-- is where every demo hotel and almost every first departure is. The hotel or airline still has the last word.
UPDATE bookings b JOIN hotel_bookings h ON h.booking_id = b.id
SET b.cancel_until = TIMESTAMP(h.check_in, CONCAT(h.check_in_time, ':00')) - INTERVAL 330 MINUTE
WHERE b.cancel_until IS NULL AND h.check_in IS NOT NULL AND h.check_in_time IS NOT NULL;

UPDATE bookings b JOIN flight_bookings f ON f.booking_id = b.id
SET b.cancel_until = STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(f.slices_json, '$[0].departureLocal')), '%Y-%m-%dT%H:%i')
        - INTERVAL 330 MINUTE - INTERVAL 4 HOUR
WHERE b.cancel_until IS NULL AND f.slices_json IS NOT NULL;

-- One row per cancellation request. Only one can be PENDING per booking (the booking is CANCELLATION_PENDING then);
-- a rejected one leaves the booking CONFIRMED, so the customer may ask again with a new key.
CREATE TABLE cancellations (
    id                 BINARY(16)     NOT NULL,
    booking_id         BINARY(16)     NOT NULL,
    status             VARCHAR(20)    NOT NULL COMMENT 'PENDING, CONFIRMED, REJECTED',
    initiated_by       VARCHAR(20)    NOT NULL COMMENT 'CUSTOMER, SUPPORT_AGENT, ADMIN',
    requested_by       VARCHAR(64)    NOT NULL COMMENT 'user id',
    reason             VARCHAR(500)   NULL,
    fee_waived         BOOLEAN        NOT NULL DEFAULT FALSE,
    currency           CHAR(3)        NOT NULL,
    paid_amount        DECIMAL(12, 2) NOT NULL,
    quoted_fee         DECIMAL(12, 2) NOT NULL COMMENT 'by the booked policy at requested_at',
    quoted_refund      DECIMAL(12, 2) NOT NULL,
    cancellation_fee   DECIMAL(12, 2) NULL COMMENT 'final, once the hotel or airline confirmed',
    refund_amount      DECIMAL(12, 2) NULL,
    supplier_fee       DECIMAL(12, 2) NULL COMMENT 'the airline''s own fee (flights)',
    supplier_reference VARCHAR(30)    NULL,
    failure_reason     VARCHAR(40)    NULL,
    failure_message    VARCHAR(255)   NULL,
    idempotency_key    VARCHAR(100)   NOT NULL,
    request_hash       CHAR(64)       NOT NULL COMMENT 'same key + other content = error',
    attempts           INT            NOT NULL DEFAULT 1 COMMENT 'times the request was sent (reconciliation)',
    last_sent_at       DATETIME(6)    NOT NULL,
    requested_at       DATETIME(6)    NOT NULL,
    completed_at       DATETIME(6)    NULL,
    version            BIGINT         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_cancellations_idempotency (booking_id, idempotency_key),
    KEY idx_cancellations_booking (booking_id, requested_at),
    KEY idx_cancellations_status (status, last_sent_at),
    CONSTRAINT fk_cancellations_booking FOREIGN KEY (booking_id) REFERENCES bookings (id)
) ENGINE = InnoDB;

ALTER TABLE booking_refund_requests
    MODIFY reason VARCHAR(30) NOT NULL COMMENT 'BOOKING_FAILED, LATE_PAYMENT, DUPLICATE_PAYMENT, CANCELLATION',
    ADD COLUMN cancellation_id BINARY(16)  NULL AFTER payment_id,
    ADD COLUMN attempts        INT         NOT NULL DEFAULT 1 COMMENT 'times the request was sent (reconciliation)',
    ADD COLUMN last_sent_at    DATETIME(6) NULL,
    ADD KEY idx_booking_refund_requests_status (status, last_sent_at);

UPDATE booking_refund_requests SET last_sent_at = requested_at WHERE last_sent_at IS NULL;

-- Internal notes of the support team (escalations, resolutions, refund retries). Never shown to the customer.
CREATE TABLE booking_support_notes (
    id          BINARY(16)   NOT NULL,
    booking_id  BINARY(16)   NOT NULL,
    action      VARCHAR(30)  NOT NULL COMMENT 'ESCALATED, RESOLVED, REFUND_RETRIED, CANCELLED_ON_BEHALF',
    note        VARCHAR(500) NULL,
    author_id   VARCHAR(64)  NOT NULL,
    author_role VARCHAR(20)  NOT NULL COMMENT 'SUPPORT_AGENT, ADMIN',
    created_at  DATETIME(6)  NOT NULL,
    PRIMARY KEY (id),
    KEY idx_booking_support_notes_booking (booking_id, created_at),
    CONSTRAINT fk_booking_support_notes_booking FOREIGN KEY (booking_id) REFERENCES bookings (id)
) ENGINE = InnoDB;
