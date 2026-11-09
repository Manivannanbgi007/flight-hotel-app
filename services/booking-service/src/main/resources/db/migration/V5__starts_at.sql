-- Phase 8: when the trip starts (check-in moment in the hotel's time zone, or the first departure in the airport's),
-- sent with BookingConfirmed for the travel reminders. Older bookings: from the cancellation deadline of Phase 7
-- (hotels: the check-in moment itself; flights: 4 hours before the departure).

ALTER TABLE bookings
    ADD COLUMN starts_at DATETIME(6) NULL COMMENT 'check-in moment / first departure' AFTER cancel_until;

UPDATE bookings SET starts_at = cancel_until WHERE booking_type = 'HOTEL' AND starts_at IS NULL;
UPDATE bookings SET starts_at = cancel_until + INTERVAL 4 HOUR WHERE booking_type = 'FLIGHT' AND starts_at IS NULL;
