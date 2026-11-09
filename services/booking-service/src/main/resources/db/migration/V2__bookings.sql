-- Bookings, the hotel part of a booking, guests, price lines, status history, refund requests and coupons
-- (DATABASE_DESIGN.md §5). Flight tables and cancellations arrive with Phases 6 and 7.

CREATE TABLE bookings (
    id                           BINARY(16)     NOT NULL,
    booking_reference            VARCHAR(12)    NOT NULL COMMENT 'HT-7K3M9Q2X / FL-...',
    user_id                      BINARY(16)     NOT NULL,
    booking_type                 VARCHAR(10)    NOT NULL COMMENT 'HOTEL, FLIGHT',
    status                       VARCHAR(25)    NOT NULL COMMENT 'BOOKING_WORKFLOW.md §1',
    payment_status               VARCHAR(20)    NOT NULL COMMENT 'UNPAID, PAYMENT_FAILED, PAID, REFUND_PENDING, REFUNDED',
    title                        VARCHAR(200)   NULL COMMENT 'hotel name or route, for lists (known once held)',
    destination                  VARCHAR(100)   NULL COMMENT 'city',
    start_date                   DATE           NULL COMMENT 'check-in / departure',
    end_date                     DATE           NULL COMMENT 'check-out / return',
    currency                     CHAR(3)        NOT NULL DEFAULT 'INR',
    base_amount                  DECIMAL(12, 2) NOT NULL DEFAULT 0,
    tax_amount                   DECIMAL(12, 2) NOT NULL DEFAULT 0,
    fee_amount                   DECIMAL(12, 2) NOT NULL DEFAULT 0,
    discount_amount              DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total_amount                 DECIMAL(12, 2) NOT NULL DEFAULT 0,
    coupon_code                  VARCHAR(30)    NULL,
    coupon_note                  VARCHAR(255)   NULL COMMENT 'why the coupon could not be applied',
    contact_email                VARCHAR(254)   NOT NULL,
    contact_phone                VARCHAR(20)    NOT NULL,
    hold_expires_at              DATETIME(6)    NULL,
    payment_deadline             DATETIME(6)    NULL,
    paid_payment_id              BINARY(16)     NULL,
    inventory_source             VARCHAR(20)    NULL COMMENT 'INTERNAL, DEMO, <provider>',
    cancellation_policy_snapshot TEXT           NULL COMMENT 'the terms the customer accepted',
    failure_reason               VARCHAR(40)    NULL,
    failure_message              VARCHAR(255)   NULL,
    idempotency_key              VARCHAR(100)   NOT NULL,
    request_hash                 CHAR(64)       NOT NULL COMMENT 'SHA-256 of the request: same key + other content = error',
    confirmed_at                 DATETIME(6)    NULL,
    created_at                   DATETIME(6)    NOT NULL,
    updated_at                   DATETIME(6)    NOT NULL,
    created_by                   VARCHAR(64)    NOT NULL,
    updated_by                   VARCHAR(64)    NOT NULL,
    version                      BIGINT         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_bookings_reference (booking_reference),
    UNIQUE KEY uk_bookings_idempotency (user_id, idempotency_key),
    KEY idx_bookings_user_created (user_id, created_at),
    KEY idx_bookings_status_created (status, created_at),
    KEY idx_bookings_status_end (status, end_date)
) ENGINE = InnoDB;

CREATE TABLE booking_price_items (
    booking_id BINARY(16)     NOT NULL,
    line_no    INT            NOT NULL,
    item_type  VARCHAR(20)    NOT NULL COMMENT 'ROOM, TAX, FEE, DISCOUNT',
    label      VARCHAR(120)   NOT NULL,
    amount     DECIMAL(12, 2) NOT NULL COMMENT 'negative for discounts',
    PRIMARY KEY (booking_id, line_no),
    CONSTRAINT fk_booking_price_items_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Hotel part of a booking. Filled from HotelInventoryHeld (prices and names come from hotel-service, never the browser).
CREATE TABLE hotel_bookings (
    booking_id               BINARY(16)    NOT NULL,
    quote_id                 BINARY(16)    NOT NULL,
    reservation_id           BINARY(16)    NULL,
    hotel_id                 BINARY(16)    NULL,
    hotel_slug               VARCHAR(180)  NULL,
    hotel_name               VARCHAR(150)  NULL,
    hotel_city               VARCHAR(100)  NULL,
    hotel_address            VARCHAR(400)  NULL,
    country_code             CHAR(2)       NULL,
    room_type_id             BINARY(16)    NULL,
    room_type_name           VARCHAR(100)  NULL,
    rate_plan_name           VARCHAR(100)  NULL,
    breakfast_included       BOOLEAN       NULL,
    check_in                 DATE          NULL,
    check_out                DATE          NULL,
    check_in_time            CHAR(5)       NULL,
    check_out_time           CHAR(5)       NULL,
    nights                   INT           NULL,
    rooms                    INT           NULL,
    adults                   INT           NULL,
    children                 INT           NULL,
    confirmation_number      VARCHAR(20)   NULL COMMENT 'shown only once CONFIRMED',
    refundable               BOOLEAN       NULL,
    free_cancellation_until  DATETIME(6)   NULL,
    cancellation_fee_percent DECIMAL(5, 2) NULL,
    special_requests         VARCHAR(500)  NULL,
    demo                     BOOLEAN       NOT NULL DEFAULT FALSE,
    PRIMARY KEY (booking_id),
    CONSTRAINT fk_hotel_bookings_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE booking_guests (
    booking_id BINARY(16)  NOT NULL,
    room_no    INT         NOT NULL,
    first_name VARCHAR(60) NOT NULL,
    last_name  VARCHAR(60) NOT NULL,
    PRIMARY KEY (booking_id, room_no),
    CONSTRAINT fk_booking_guests_booking FOREIGN KEY (booking_id) REFERENCES hotel_bookings (booking_id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Every status change (and notable events that keep the status, like a failed payment): the booking timeline.
CREATE TABLE booking_status_history (
    id                 BINARY(16)   NOT NULL,
    booking_id         BINARY(16)   NOT NULL,
    from_status        VARCHAR(25)  NULL,
    to_status          VARCHAR(25)  NOT NULL,
    reason             VARCHAR(255) NULL,
    changed_by         VARCHAR(64)  NOT NULL COMMENT 'user id or SYSTEM',
    caused_by_event_id CHAR(36)     NULL,
    changed_at         DATETIME(6)  NOT NULL,
    PRIMARY KEY (id),
    KEY idx_booking_status_history_booking (booking_id, changed_at),
    CONSTRAINT fk_booking_status_history_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Money booking-service asked payment-service to give back (id = refundRequestId, the idempotency key).
CREATE TABLE booking_refund_requests (
    id             BINARY(16)     NOT NULL,
    booking_id     BINARY(16)     NOT NULL,
    payment_id     BINARY(16)     NOT NULL,
    amount         DECIMAL(12, 2) NOT NULL,
    currency       CHAR(3)        NOT NULL,
    reason         VARCHAR(30)    NOT NULL COMMENT 'BOOKING_FAILED, LATE_PAYMENT, DUPLICATE_PAYMENT, CANCELLATION',
    status         VARCHAR(20)    NOT NULL COMMENT 'REQUESTED, COMPLETED, FAILED',
    failure_reason VARCHAR(255)   NULL,
    requested_at   DATETIME(6)    NOT NULL,
    completed_at   DATETIME(6)    NULL,
    version        BIGINT         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_booking_refund_requests_booking (booking_id),
    CONSTRAINT fk_booking_refund_requests_booking FOREIGN KEY (booking_id) REFERENCES bookings (id)
) ENGINE = InnoDB;

CREATE TABLE coupons (
    id                 BINARY(16)     NOT NULL,
    code               VARCHAR(30)    NOT NULL COMMENT 'upper case',
    title              VARCHAR(100)   NOT NULL,
    description        VARCHAR(500)   NULL,
    discount_type      VARCHAR(10)    NOT NULL COMMENT 'PERCENT, FIXED',
    discount_value     DECIMAL(12, 2) NOT NULL,
    max_discount       DECIMAL(12, 2) NULL COMMENT 'cap for PERCENT coupons',
    min_booking_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    applies_to         VARCHAR(10)    NOT NULL COMMENT 'ALL, HOTEL, FLIGHT',
    destination_city   VARCHAR(100)   NULL COMMENT 'only bookings to this city',
    valid_from         DATETIME(6)    NOT NULL,
    valid_to           DATETIME(6)    NOT NULL,
    usage_limit        INT            NULL COMMENT 'NULL = unlimited',
    per_customer_limit INT            NOT NULL DEFAULT 1,
    used_count         INT            NOT NULL DEFAULT 0 COMMENT 'reserved + consumed',
    status             VARCHAR(10)    NOT NULL COMMENT 'ACTIVE, INACTIVE',
    demo               BOOLEAN        NOT NULL DEFAULT FALSE,
    created_at         DATETIME(6)    NOT NULL,
    updated_at         DATETIME(6)    NOT NULL,
    created_by         VARCHAR(64)    NOT NULL,
    updated_by         VARCHAR(64)    NOT NULL,
    version            BIGINT         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_coupons_code (code),
    CONSTRAINT ck_coupons_value CHECK (discount_value > 0),
    CONSTRAINT ck_coupons_used CHECK (usage_limit IS NULL OR used_count <= usage_limit)
) ENGINE = InnoDB;

CREATE TABLE coupon_usage (
    id              BINARY(16)     NOT NULL,
    coupon_id       BINARY(16)     NOT NULL,
    user_id         BINARY(16)     NOT NULL,
    booking_id      BINARY(16)     NOT NULL,
    discount_amount DECIMAL(12, 2) NOT NULL,
    status          VARCHAR(10)    NOT NULL COMMENT 'RESERVED, CONSUMED, RELEASED',
    created_at      DATETIME(6)    NOT NULL,
    updated_at      DATETIME(6)    NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_coupon_usage_booking (booking_id),
    KEY idx_coupon_usage_customer (coupon_id, user_id, status),
    CONSTRAINT fk_coupon_usage_coupon FOREIGN KEY (coupon_id) REFERENCES coupons (id)
) ENGINE = InnoDB;
