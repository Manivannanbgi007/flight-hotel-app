-- Phase 9: the hotel's front desk (API_DOCUMENTATION.md §14.5): check-in, check-out, no-show, and cancellations
-- made by the hotel itself (overbooking, closure), which booking-service refunds in full.

ALTER TABLE hotel_reservations
    MODIFY status VARCHAR(20) NOT NULL COMMENT 'HELD, CONFIRMED, CHECKED_IN, CHECKED_OUT, NO_SHOW, CANCELLED, EXPIRED, RELEASED',
    ADD COLUMN checked_in_at       DATETIME(6)  NULL AFTER confirmed_at,
    ADD COLUMN checked_out_at      DATETIME(6)  NULL AFTER checked_in_at,
    ADD COLUMN no_show_at          DATETIME(6)  NULL COMMENT 'when the hotel recorded that the guest never arrived' AFTER checked_out_at,
    ADD COLUMN cancelled_by        VARCHAR(10)  NULL COMMENT 'CUSTOMER (asked through booking-service) or HOTEL' AFTER cancelled_at,
    ADD COLUMN cancellation_reason VARCHAR(300) NULL COMMENT 'the hotel''s reason (HOTEL cancellations only)' AFTER cancelled_by,
    ADD KEY idx_hotel_reservations_user (user_id, status),
    ADD KEY idx_hotel_reservations_hotel_created (hotel_id, created_at);

-- Every cancellation before Phase 9 was asked for by the customer.
UPDATE hotel_reservations SET cancelled_by = 'CUSTOMER' WHERE status = 'CANCELLED';
