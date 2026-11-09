-- Phase 9: offers (home page and Offers page), goodwill refunds started by an admin, admin search by creation date,
-- and one-time data backfills (the snapshot of every booking for reporting-service).

CREATE TABLE offers (
    id               BINARY(16)   NOT NULL,
    title            VARCHAR(80)  NOT NULL,
    description      VARCHAR(300) NULL,
    coupon_id        BINARY(16)   NOT NULL COMMENT 'the code the offer advertises; the discount rules are the coupon''s',
    applies_to       VARCHAR(10)  NOT NULL DEFAULT 'ALL' COMMENT 'ALL, FLIGHT, HOTEL (where the offer is shown)',
    destination_city VARCHAR(100) NULL,
    valid_from       DATETIME(6)  NOT NULL,
    valid_to         DATETIME(6)  NOT NULL,
    seasonal         BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'shown as a seasonal promotion',
    theme            VARCHAR(10)  NOT NULL DEFAULT 'OCEAN' COMMENT 'OCEAN, SUNSET, FOREST, CITY: card colours',
    status           VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE, INACTIVE',
    demo             BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at       DATETIME(6)  NOT NULL,
    updated_at       DATETIME(6)  NOT NULL,
    created_by       VARCHAR(64)  NOT NULL,
    updated_by       VARCHAR(64)  NOT NULL,
    version          BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_offers_status_valid (status, valid_to),
    CONSTRAINT fk_offers_coupon FOREIGN KEY (coupon_id) REFERENCES coupons (id)
) ENGINE = InnoDB;

-- Goodwill refunds: the admin's Idempotency-Key, who asked and why (the refund reason itself is GOODWILL).
ALTER TABLE booking_refund_requests
    ADD COLUMN idempotency_key VARCHAR(100) NULL AFTER reason,
    ADD COLUMN request_hash    CHAR(64)     NULL AFTER idempotency_key,
    ADD COLUMN requested_by    VARCHAR(64)  NULL COMMENT 'user id (goodwill refunds)' AFTER request_hash,
    ADD COLUMN note            VARCHAR(500) NULL COMMENT 'why (goodwill refunds)' AFTER requested_by,
    ADD UNIQUE KEY uk_refund_requests_idempotency (booking_id, idempotency_key);

-- Admin booking search by creation date.
CREATE INDEX idx_bookings_created ON bookings (created_at);

-- One-time jobs run at start-up by exactly one instance (the row is locked while it runs).
CREATE TABLE data_backfills (
    name    VARCHAR(60) NOT NULL,
    done_at DATETIME(6) NULL,
    PRIMARY KEY (name)
) ENGINE = InnoDB;

INSERT INTO data_backfills (name) VALUES ('booking-snapshots');
