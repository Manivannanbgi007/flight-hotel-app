-- The admin payments list filters and shows HOTEL / FLIGHT. The type comes with BookingAwaitingPayment; payable
-- bookings that already exist get it from the prefix of their reference (HT-... hotel, FL-... flight).
ALTER TABLE payable_bookings
    ADD COLUMN booking_type VARCHAR(10) NULL COMMENT 'HOTEL, FLIGHT' AFTER booking_reference;

UPDATE payable_bookings
   SET booking_type = CASE
       WHEN booking_reference LIKE 'HT-%' THEN 'HOTEL'
       WHEN booking_reference LIKE 'FL-%' THEN 'FLIGHT'
       ELSE NULL END
 WHERE booking_type IS NULL;

CREATE INDEX idx_payable_bookings_type ON payable_bookings (booking_type);
