-- The flight part of a booking and its passengers (DATABASE_DESIGN.md section 5). Filled from FlightOfferHeld:
-- routes, fares and prices come from flight-service, never from the browser. The trip's flights are kept as a JSON
-- snapshot (slices_json) of exactly what was held, so the booking page never depends on the search data again.

CREATE TABLE flight_bookings (
    booking_id               BINARY(16)  NOT NULL,
    offer_id                 VARCHAR(40) NOT NULL COMMENT 'the trip offer the customer accepted',
    hold_id                  BINARY(16)  NULL,
    provider                 VARCHAR(20) NULL,
    trip_type                VARCHAR(10) NULL COMMENT 'ONE_WAY, ROUND_TRIP',
    cabin                    VARCHAR(20) NULL,
    fare_name                VARCHAR(40) NULL,
    refundable               BOOLEAN     NULL,
    checked_baggage_kg       INT         NULL,
    cabin_baggage_kg         INT         NULL,
    cancellation_fee_percent INT         NULL,
    adults                   INT         NOT NULL,
    children                 INT         NOT NULL,
    infants                  INT         NOT NULL,
    slices_json              MEDIUMTEXT  NULL,
    pnr                      CHAR(6)     NULL COMMENT 'shown only once CONFIRMED',
    demo                     BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (booking_id),
    CONSTRAINT fk_flight_bookings_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE booking_passengers (
    id                  BINARY(16)   NOT NULL,
    booking_id          BINARY(16)   NOT NULL,
    passenger_no        INT          NOT NULL COMMENT 'adults, then children, then infants',
    passenger_type      VARCHAR(10)  NOT NULL COMMENT 'ADULT, CHILD, INFANT',
    first_name          VARCHAR(60)  NOT NULL,
    last_name           VARCHAR(60)  NOT NULL,
    date_of_birth       DATE         NULL,
    gender              VARCHAR(10)  NULL,
    nationality         CHAR(2)      NULL,
    passport_number_enc VARCHAR(255) NULL COMMENT 'AES-256-GCM (v1:...), never in events or API answers',
    passport_last4      CHAR(4)      NULL,
    passport_expiry     DATE         NULL,
    passport_country    CHAR(2)      NULL,
    ticket_number       VARCHAR(20)  NULL COMMENT 'shown only once CONFIRMED',
    PRIMARY KEY (id),
    UNIQUE KEY uk_booking_passengers (booking_id, passenger_no),
    CONSTRAINT fk_booking_passengers_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE = InnoDB;
