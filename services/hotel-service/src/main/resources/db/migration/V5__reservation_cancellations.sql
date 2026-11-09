-- Phase 7: a confirmed reservation can be cancelled on booking-service's request (BOOKING_WORKFLOW.md section 4).
-- The booked rooms go back on sale; cancellation_id is booking-service's idempotency key for the request.

ALTER TABLE hotel_reservations
    MODIFY status VARCHAR(20) NOT NULL COMMENT 'HELD, CONFIRMED, EXPIRED, RELEASED, CANCELLED (later: CHECKED_IN, CHECKED_OUT, NO_SHOW)',
    ADD COLUMN cancellation_id        BINARY(16)  NULL COMMENT 'booking-service cancellation (idempotency key)' AFTER release_reason,
    ADD COLUMN cancellation_reference VARCHAR(20) NULL COMMENT 'the hotel''s cancellation number' AFTER cancellation_id,
    ADD COLUMN cancelled_at           DATETIME(6) NULL AFTER cancellation_reference,
    ADD UNIQUE KEY uk_hotel_reservations_cancellation (cancellation_reference);
