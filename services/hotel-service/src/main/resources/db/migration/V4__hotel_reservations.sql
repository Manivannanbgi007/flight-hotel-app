-- Phase 5: rooms held / booked for a booking (BOOKING_WORKFLOW.md §2). One reservation per booking.
-- The per-night counters live in room_inventory; this table says WHO holds them and until when.

CREATE TABLE hotel_reservations (
    id                  BINARY(16)     NOT NULL,
    booking_id          BINARY(16)     NOT NULL COMMENT 'from booking-service (no FK across services)',
    booking_reference   VARCHAR(20)    NOT NULL,
    user_id             BINARY(16)     NOT NULL,
    hotel_id            BINARY(16)     NOT NULL,
    room_type_id        BINARY(16)     NOT NULL,
    rate_plan_id        BINARY(16)     NOT NULL,
    quote_id            BINARY(16)     NOT NULL,
    check_in            DATE           NOT NULL,
    check_out           DATE           NOT NULL,
    rooms               INT            NOT NULL,
    adults              INT            NOT NULL,
    children            INT            NOT NULL,
    status              VARCHAR(20)    NOT NULL COMMENT 'HELD, CONFIRMED, EXPIRED, RELEASED (later: CANCELLED, CHECKED_IN, CHECKED_OUT, NO_SHOW)',
    hold_expires_at     DATETIME(6)    NULL,
    confirmation_number VARCHAR(20)    NULL,
    currency            CHAR(3)        NOT NULL,
    subtotal            DECIMAL(12, 2) NOT NULL,
    taxes               DECIMAL(12, 2) NOT NULL,
    total_amount        DECIMAL(12, 2) NOT NULL,
    contact_email       VARCHAR(254)   NOT NULL,
    contact_phone       VARCHAR(20)    NOT NULL,
    special_requests    VARCHAR(500)   NULL,
    confirmed_at        DATETIME(6)    NULL,
    released_at         DATETIME(6)    NULL,
    release_reason      VARCHAR(30)    NULL,
    created_at          DATETIME(6)    NOT NULL,
    updated_at          DATETIME(6)    NOT NULL,
    created_by          VARCHAR(64)    NOT NULL,
    updated_by          VARCHAR(64)    NOT NULL,
    version             BIGINT         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_hotel_reservations_booking (booking_id),
    UNIQUE KEY uk_hotel_reservations_confirmation (confirmation_number),
    KEY idx_hotel_reservations_hold (status, hold_expires_at),
    KEY idx_hotel_reservations_hotel (hotel_id, check_in),
    CONSTRAINT fk_hotel_reservations_hotel FOREIGN KEY (hotel_id) REFERENCES hotels (id),
    CONSTRAINT fk_hotel_reservations_room_type FOREIGN KEY (room_type_id) REFERENCES room_types (id),
    CONSTRAINT fk_hotel_reservations_rate_plan FOREIGN KEY (rate_plan_id) REFERENCES rate_plans (id),
    CONSTRAINT ck_hotel_reservations_dates CHECK (check_out > check_in),
    CONSTRAINT ck_hotel_reservations_rooms CHECK (rooms BETWEEN 1 AND 8)
) ENGINE = InnoDB;

-- The guest named for each room (the hotel's arrival list).
CREATE TABLE hotel_reservation_guests (
    reservation_id BINARY(16)   NOT NULL,
    room_no        INT          NOT NULL,
    first_name     VARCHAR(60)  NOT NULL,
    last_name      VARCHAR(60)  NOT NULL,
    PRIMARY KEY (reservation_id, room_no),
    CONSTRAINT fk_hotel_reservation_guests_reservation FOREIGN KEY (reservation_id)
        REFERENCES hotel_reservations (id) ON DELETE CASCADE
) ENGINE = InnoDB;
