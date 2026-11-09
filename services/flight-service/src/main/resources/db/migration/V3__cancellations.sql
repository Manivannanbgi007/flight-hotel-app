-- Phase 7: cancellations (BOOKING_WORKFLOW.md section 4).
--
-- The DEMO airline remembers what it sold with each order (seats, fare, total, fee %), so it can cancel the order at
-- its own fee and put the seats back on sale. flight-service records the cancellation of its supplier booking.

ALTER TABLE demo_orders
    ADD COLUMN seats              TEXT          NULL COMMENT 'scheduleId|date|cabin|seats;... what was sold',
    ADD COLUMN currency           CHAR(3)       NULL,
    ADD COLUMN fare_amount        DECIMAL(12, 2) NULL COMMENT 'base fares: the cancellation fee is a share of it',
    ADD COLUMN total_amount       DECIMAL(12, 2) NULL,
    ADD COLUMN cancel_fee_percent INT           NULL,
    ADD COLUMN cancel_behaviour   VARCHAR(15)   NOT NULL DEFAULT 'NORMAL' COMMENT 'simulation: NORMAL, REJECT, TIMEOUT, LOST',
    ADD COLUMN cancel_key         VARCHAR(64)   NULL COMMENT 'idempotency key of the cancellation',
    ADD COLUMN cancel_ref         VARCHAR(20)   NULL,
    ADD COLUMN penalty            DECIMAL(12, 2) NULL,
    ADD COLUMN refund_amount      DECIMAL(12, 2) NULL,
    ADD COLUMN cancelled_at       DATETIME(6)   NULL,
    ADD UNIQUE KEY uk_demo_orders_cancel_ref (cancel_ref);

-- Orders issued before this migration: what was sold, from flight-service's own records (same database).
UPDATE demo_orders d
    JOIN flight_supplier_bookings b ON b.idempotency_key = d.idempotency_key
SET d.seats = (SELECT GROUP_CONCAT(CONCAT(BIN_TO_UUID(h.schedule_id), '|', h.flight_date, '|', h.cabin, '|', h.seats)
                                   SEPARATOR ';')
               FROM flight_hold_items h WHERE h.booking_id = b.booking_id),
    d.currency = b.currency,
    d.total_amount = b.total_amount,
    d.fare_amount = CAST(JSON_UNQUOTE(JSON_EXTRACT(b.trip_json, '$.subtotal')) AS DECIMAL(12, 2)),
    d.cancel_fee_percent = GREATEST(
            COALESCE(CAST(JSON_EXTRACT(b.trip_json, '$.slices[0].fare.cancellationFeePercent') AS UNSIGNED), 100),
            COALESCE(CAST(JSON_EXTRACT(b.trip_json, '$.slices[1].fare.cancellationFeePercent') AS UNSIGNED), 0)),
    d.cancel_behaviour = CASE
            WHEN UPPER(b.passengers_json) LIKE '%"LASTNAME":"NOCANCEL"%' THEN 'REJECT'
            WHEN UPPER(b.passengers_json) LIKE '%"LASTNAME":"CANCELTIMEOUT"%' THEN 'TIMEOUT'
            WHEN UPPER(b.passengers_json) LIKE '%"LASTNAME":"CANCELLOST"%' THEN 'LOST'
            ELSE 'NORMAL' END
WHERE d.seats IS NULL;

ALTER TABLE flight_supplier_bookings
    MODIFY status VARCHAR(20) NOT NULL COMMENT 'HELD, CONFIRMED, FAILED, UNCERTAIN, NEEDS_ATTENTION, RELEASED, EXPIRED, CANCEL_UNCERTAIN, CANCELLED',
    ADD COLUMN cancellation_id        CHAR(36)      NULL COMMENT 'booking-service cancellation (idempotency key)' AFTER next_reconcile_at,
    ADD COLUMN cancellation_reference VARCHAR(20)   NULL AFTER cancellation_id,
    ADD COLUMN cancel_fee             DECIMAL(12, 2) NULL COMMENT 'the airline''s cancellation fee' AFTER cancellation_reference,
    ADD COLUMN cancel_refund          DECIMAL(12, 2) NULL COMMENT 'what the airline gives back' AFTER cancel_fee,
    ADD COLUMN cancelled_at           DATETIME(6)   NULL AFTER cancel_refund;
