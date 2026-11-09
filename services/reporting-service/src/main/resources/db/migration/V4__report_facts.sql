-- Phase 9: read models for the admin dashboard, the reports and the home page (API_DOCUMENTATION.md section 14.1).
-- Built only from events (booking.events, payment.events, identity.events); every write is an idempotent upsert keyed
-- by the business id, so redelivered or replayed events change nothing. Times are UTC; reports group by India days.

-- The latest BookingSnapshot of every booking (event-carried state transfer from booking-service).
CREATE TABLE booking_facts (
    booking_id        BINARY(16)     NOT NULL,
    booking_reference VARCHAR(12)    NOT NULL,
    user_id           BINARY(16)     NOT NULL,
    booking_type      VARCHAR(10)    NOT NULL COMMENT 'HOTEL, FLIGHT',
    status            VARCHAR(25)    NOT NULL,
    payment_status    VARCHAR(20)    NOT NULL,
    title             VARCHAR(200)   NULL,
    destination       VARCHAR(100)   NULL COMMENT 'city',
    hotel_id          BINARY(16)     NULL,
    route_origin      VARCHAR(3)     NULL COMMENT 'flights: first departure airport',
    route_destination VARCHAR(3)     NULL,
    origin_city       VARCHAR(100)   NULL,
    start_date        DATE           NULL,
    end_date          DATE           NULL,
    currency          CHAR(3)        NOT NULL,
    total_amount      DECIMAL(12, 2) NOT NULL,
    discount_amount   DECIMAL(12, 2) NOT NULL,
    refunded_amount   DECIMAL(12, 2) NOT NULL,
    contact_email     VARCHAR(254)   NOT NULL,
    coupon_code       VARCHAR(30)    NULL,
    created_at        DATETIME(6)    NOT NULL,
    confirmed_at      DATETIME(6)    NULL COMMENT 'set = the booking was paid and confirmed at some point',
    cancelled_at      DATETIME(6)    NULL,
    demo              BOOLEAN        NOT NULL DEFAULT FALSE,
    changed_at        DATETIME(6)    NOT NULL COMMENT 'of the snapshot: an older one never overwrites a newer one',
    received_at       DATETIME(6)    NOT NULL,
    PRIMARY KEY (booking_id),
    KEY idx_booking_facts_created (created_at),
    KEY idx_booking_facts_user (user_id, created_at),
    KEY idx_booking_facts_reference (booking_reference),
    KEY idx_booking_facts_destination (destination, created_at),
    KEY idx_booking_facts_hotel (hotel_id, created_at)
) ENGINE = InnoDB;

-- Payment attempts that ended: captured (SUCCESS) or failed. A failed attempt has no amount in its event.
CREATE TABLE payment_facts (
    payment_id   BINARY(16)     NOT NULL,
    booking_id   BINARY(16)     NOT NULL,
    user_id      BINARY(16)     NOT NULL,
    provider     VARCHAR(20)    NOT NULL,
    method       VARCHAR(30)    NULL,
    status       VARCHAR(10)    NOT NULL COMMENT 'SUCCESS, FAILED (SUCCESS is final)',
    amount       DECIMAL(12, 2) NULL,
    currency     CHAR(3)        NULL,
    failure_code VARCHAR(40)    NULL,
    occurred_at  DATETIME(6)    NOT NULL COMMENT 'captured / failed at',
    received_at  DATETIME(6)    NOT NULL,
    PRIMARY KEY (payment_id),
    KEY idx_payment_facts_status (status, occurred_at),
    KEY idx_payment_facts_booking (booking_id)
) ENGINE = InnoDB;

-- Money booking-service asked payment-service to give back, and what became of it.
CREATE TABLE refund_facts (
    refund_request_id BINARY(16)     NOT NULL,
    booking_id        BINARY(16)     NOT NULL,
    booking_reference VARCHAR(12)    NULL,
    payment_id        BINARY(16)     NOT NULL,
    amount            DECIMAL(12, 2) NOT NULL,
    currency          CHAR(3)        NOT NULL,
    reason            VARCHAR(30)    NULL COMMENT 'CANCELLATION, GOODWILL, BOOKING_FAILED, LATE_PAYMENT, DUPLICATE_PAYMENT',
    status            VARCHAR(10)    NOT NULL COMMENT 'REQUESTED, COMPLETED, FAILED',
    requested_at      DATETIME(6)    NULL,
    completed_at      DATETIME(6)    NULL,
    failed_at         DATETIME(6)    NULL,
    failure_reason    VARCHAR(255)   NULL,
    received_at       DATETIME(6)    NOT NULL,
    PRIMARY KEY (refund_request_id),
    KEY idx_refund_facts_requested (requested_at),
    KEY idx_refund_facts_completed (status, completed_at),
    KEY idx_refund_facts_payment (payment_id),
    KEY idx_refund_facts_booking (booking_id)
) ENGINE = InnoDB;

CREATE TABLE cancellation_facts (
    cancellation_id   BINARY(16)     NOT NULL,
    booking_id        BINARY(16)     NOT NULL,
    booking_reference VARCHAR(12)    NOT NULL,
    booking_type      VARCHAR(10)    NOT NULL,
    title             VARCHAR(200)   NULL,
    initiated_by      VARCHAR(20)    NOT NULL COMMENT 'CUSTOMER, SUPPORT_AGENT, ADMIN, HOTEL',
    currency          CHAR(3)        NOT NULL,
    paid_amount       DECIMAL(12, 2) NOT NULL,
    cancellation_fee  DECIMAL(12, 2) NOT NULL,
    refund_amount     DECIMAL(12, 2) NOT NULL,
    fee_waived        BOOLEAN        NOT NULL,
    cancelled_at      DATETIME(6)    NOT NULL,
    received_at       DATETIME(6)    NOT NULL,
    PRIMARY KEY (cancellation_id),
    KEY idx_cancellation_facts_cancelled (cancelled_at),
    KEY idx_cancellation_facts_booking (booking_id)
) ENGINE = InnoDB;

CREATE TABLE user_facts (
    user_id        BINARY(16)   NOT NULL,
    email          VARCHAR(254) NOT NULL,
    first_name     VARCHAR(100) NULL,
    last_name      VARCHAR(100) NULL,
    roles          VARCHAR(200) NOT NULL COMMENT 'comma separated',
    status         VARCHAR(30)  NOT NULL,
    email_verified BOOLEAN      NOT NULL DEFAULT FALSE,
    registered_at  DATETIME(6)  NOT NULL,
    updated_at     DATETIME(6)  NOT NULL,
    PRIMARY KEY (user_id),
    KEY idx_user_facts_registered (registered_at)
) ENGINE = InnoDB;
