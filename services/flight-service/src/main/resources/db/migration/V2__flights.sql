-- Flight reference data, the DEMO provider's airline system, and flight-service's own booking records
-- (DATABASE_DESIGN.md section 4). demo_* tables belong only to the DEMO provider (an airline simulation).

CREATE TABLE airports (
    iata_code    CHAR(3)       NOT NULL,
    name         VARCHAR(120)  NOT NULL,
    city         VARCHAR(80)   NOT NULL,
    country_code CHAR(2)       NOT NULL,
    latitude     DECIMAL(9, 6) NOT NULL,
    longitude    DECIMAL(9, 6) NOT NULL,
    timezone     VARCHAR(40)   NOT NULL COMMENT 'IANA zone, e.g. Asia/Kolkata',
    PRIMARY KEY (iata_code),
    KEY idx_airports_city (city)
) ENGINE = InnoDB;

CREATE TABLE airlines (
    iata_code    VARCHAR(3)   NOT NULL,
    name         VARCHAR(80)  NOT NULL,
    country_code CHAR(2)      NOT NULL,
    PRIMARY KEY (iata_code)
) ENGINE = InnoDB;

CREATE TABLE flight_providers (
    id                BINARY(16)   NOT NULL,
    code              VARCHAR(20)  NOT NULL COMMENT 'DEMO, DUFFEL, ...',
    name              VARCHAR(80)  NOT NULL,
    enabled           BOOLEAN      NOT NULL,
    is_demo           BOOLEAN      NOT NULL,
    priority          INT          NOT NULL,
    timeout_ms        INT          NOT NULL,
    health_status     VARCHAR(10)  NOT NULL COMMENT 'UP, DEGRADED, DOWN, UNKNOWN',
    health_checked_at DATETIME(6)  NULL,
    last_error        VARCHAR(255) NULL,
    created_at        DATETIME(6)  NOT NULL,
    updated_at        DATETIME(6)  NOT NULL,
    created_by        VARCHAR(64)  NOT NULL,
    updated_by        VARCHAR(64)  NOT NULL,
    version           BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_flight_providers_code (code)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------- the DEMO airline system

CREATE TABLE demo_fare_families (
    id                  INT           NOT NULL AUTO_INCREMENT,
    cabin               VARCHAR(20)   NOT NULL COMMENT 'ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST',
    fare_type           VARCHAR(15)   NOT NULL COMMENT 'REFUNDABLE, NON_REFUNDABLE',
    name                VARCHAR(40)   NOT NULL,
    checked_baggage_kg  INT           NOT NULL,
    cabin_baggage_kg    INT           NOT NULL,
    cancel_fee_percent  INT           NOT NULL,
    price_multiplier    DECIMAL(5, 2) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_demo_fare_families (cabin, fare_type)
) ENGINE = InnoDB;

CREATE TABLE demo_flight_schedules (
    id               BINARY(16)   NOT NULL,
    airline_code     VARCHAR(3)   NOT NULL,
    flight_number    VARCHAR(10)  NOT NULL,
    origin           CHAR(3)      NOT NULL,
    destination      CHAR(3)      NOT NULL,
    departure_local  TIME         NOT NULL,
    duration_minutes INT          NOT NULL COMMENT 'door to door, including a layover',
    days_of_week     VARCHAR(7)   NOT NULL COMMENT '1 = Monday ... 7 = Sunday',
    stops            TINYINT      NOT NULL,
    via_airport      CHAR(3)      NULL,
    layover_minutes  INT          NOT NULL DEFAULT 0,
    international    BOOLEAN      NOT NULL,
    distance_km      INT          NOT NULL,
    cabins           VARCHAR(80)  NOT NULL COMMENT 'comma separated cabins this flight sells',
    PRIMARY KEY (id),
    UNIQUE KEY uk_demo_schedules_flight (flight_number, origin, destination),
    KEY idx_demo_schedules_route (origin, destination)
) ENGINE = InnoDB;

CREATE TABLE demo_seat_inventory (
    id          BINARY(16)  NOT NULL,
    schedule_id BINARY(16)  NOT NULL,
    flight_date DATE        NOT NULL,
    cabin       VARCHAR(20) NOT NULL,
    seats_total INT         NOT NULL,
    seats_held  INT         NOT NULL DEFAULT 0,
    seats_sold  INT         NOT NULL DEFAULT 0,
    version     BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_demo_seat_inventory (schedule_id, flight_date, cabin),
    CONSTRAINT ck_demo_seats CHECK (seats_held >= 0 AND seats_sold >= 0 AND seats_held + seats_sold <= seats_total)
) ENGINE = InnoDB;

-- The airline's own record of an order. The idempotency key makes order creation safe to repeat.
CREATE TABLE demo_orders (
    supplier_order_id VARCHAR(20)  NOT NULL,
    idempotency_key   VARCHAR(64)  NOT NULL,
    pnr               CHAR(6)      NOT NULL,
    status            VARCHAR(15)  NOT NULL,
    tickets           TEXT         NOT NULL COMMENT 'passenger number:ticket number, comma separated',
    created_at        DATETIME(6)  NOT NULL,
    PRIMARY KEY (supplier_order_id),
    UNIQUE KEY uk_demo_orders_key (idempotency_key),
    UNIQUE KEY uk_demo_orders_pnr (pnr)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------- flight-service's own records

CREATE TABLE flight_supplier_bookings (
    id                 BINARY(16)     NOT NULL,
    booking_id         BINARY(16)     NOT NULL,
    booking_reference  VARCHAR(12)    NOT NULL,
    user_id            BINARY(16)     NOT NULL,
    provider_code      VARCHAR(20)    NOT NULL,
    offer_id           VARCHAR(40)    NOT NULL COMMENT 'the trip offer the customer accepted',
    idempotency_key    VARCHAR(64)    NOT NULL COMMENT 'booking id: the supplier creates one order per key',
    status             VARCHAR(20)    NOT NULL COMMENT 'HELD, CONFIRMED, FAILED, UNCERTAIN, NEEDS_ATTENTION, RELEASED, EXPIRED',
    title              VARCHAR(200)   NOT NULL,
    trip_json          MEDIUMTEXT     NOT NULL COMMENT 'the trip as held (slices, fares, price lines)',
    passengers_json    TEXT           NOT NULL COMMENT 'names, types, dates of birth: never passport data',
    adults             INT            NOT NULL,
    children           INT            NOT NULL,
    infants            INT            NOT NULL,
    currency           CHAR(3)        NOT NULL,
    total_amount       DECIMAL(12, 2) NOT NULL,
    hold_expires_at    DATETIME(6)    NOT NULL,
    supplier_order_id  VARCHAR(20)    NULL,
    pnr                CHAR(6)        NULL,
    attempts           INT            NOT NULL DEFAULT 0 COMMENT 'reconciliation look-ups so far',
    last_error_code    VARCHAR(40)    NULL,
    uncertain_since    DATETIME(6)    NULL,
    next_reconcile_at  DATETIME(6)    NULL,
    created_at         DATETIME(6)    NOT NULL,
    updated_at         DATETIME(6)    NOT NULL,
    created_by         VARCHAR(64)    NOT NULL,
    updated_by         VARCHAR(64)    NOT NULL,
    version            BIGINT         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_flight_supplier_bookings_booking (booking_id),
    UNIQUE KEY uk_flight_supplier_bookings_key (idempotency_key),
    KEY idx_flight_supplier_bookings_hold (status, hold_expires_at),
    KEY idx_flight_supplier_bookings_reconcile (status, next_reconcile_at)
) ENGINE = InnoDB;

-- Which seats a hold took, so they can be given back or sold exactly.
CREATE TABLE flight_hold_items (
    id          BINARY(16)  NOT NULL,
    booking_id  BINARY(16)  NOT NULL,
    schedule_id BINARY(16)  NOT NULL,
    flight_date DATE        NOT NULL,
    cabin       VARCHAR(20) NOT NULL,
    seats       INT         NOT NULL,
    PRIMARY KEY (id),
    KEY idx_flight_hold_items_booking (booking_id),
    CONSTRAINT fk_flight_hold_items_booking FOREIGN KEY (booking_id)
        REFERENCES flight_supplier_bookings (booking_id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE flight_supplier_tickets (
    id                 BINARY(16)  NOT NULL,
    booking_id         BINARY(16)  NOT NULL,
    passenger_no       INT         NOT NULL,
    ticket_number      VARCHAR(20) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_flight_supplier_tickets (booking_id, passenger_no),
    CONSTRAINT fk_flight_supplier_tickets_booking FOREIGN KEY (booking_id)
        REFERENCES flight_supplier_bookings (booking_id) ON DELETE CASCADE
) ENGINE = InnoDB;
