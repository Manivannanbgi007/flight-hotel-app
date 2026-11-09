-- Hotel catalog, rooms, prices and per-day inventory (DATABASE_DESIGN.md §3).
-- Reservations and reviews are added in their phases (5 and 8).

CREATE TABLE amenities (
    id       BINARY(16)   NOT NULL,
    code     VARCHAR(40)  NOT NULL,
    name     VARCHAR(80)  NOT NULL,
    category VARCHAR(10)  NOT NULL COMMENT 'HOTEL or ROOM',
    PRIMARY KEY (id),
    UNIQUE KEY uk_amenities_code (code)
) ENGINE = InnoDB;

CREATE TABLE hotels (
    id              BINARY(16)    NOT NULL,
    name            VARCHAR(150)  NOT NULL,
    slug            VARCHAR(180)  NOT NULL COMMENT 'URL name, e.g. sea-breeze-resort-goa',
    description     TEXT          NULL,
    property_type   VARCHAR(20)   NOT NULL COMMENT 'HOTEL, RESORT, APARTMENT, VILLA, HOSTEL, GUEST_HOUSE',
    star_rating     INT           NULL COMMENT '1-5, NULL = unrated',
    address_line    VARCHAR(255)  NOT NULL,
    city            VARCHAR(100)  NOT NULL,
    state           VARCHAR(100)  NULL,
    country_code    CHAR(2)       NOT NULL,
    postal_code     VARCHAR(20)   NULL,
    latitude        DECIMAL(9, 6) NULL,
    longitude       DECIMAL(9, 6) NULL,
    time_zone       VARCHAR(40)   NOT NULL DEFAULT 'Asia/Kolkata' COMMENT 'for check-in times and cancellation deadlines',
    check_in_time   TIME          NOT NULL DEFAULT '14:00:00',
    check_out_time  TIME          NOT NULL DEFAULT '11:00:00',
    contact_email   VARCHAR(254)  NULL,
    contact_phone   VARCHAR(20)   NULL,
    avg_rating      DECIMAL(2, 1) NULL COMMENT '1.0-5.0, maintained by reviews',
    review_count    INT           NOT NULL DEFAULT 0,
    status          VARCHAR(10)   NOT NULL COMMENT 'DRAFT, ACTIVE, INACTIVE',
    data_source     VARCHAR(10)   NOT NULL COMMENT 'INTERNAL or DEMO (shown to customers)',
    created_at      DATETIME(6)   NOT NULL,
    updated_at      DATETIME(6)   NOT NULL,
    created_by      VARCHAR(64)   NOT NULL,
    updated_by      VARCHAR(64)   NOT NULL,
    version         BIGINT        NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_hotels_slug (slug),
    KEY idx_hotels_city (city),
    KEY idx_hotels_status (status),
    CONSTRAINT ck_hotels_star_rating CHECK (star_rating IS NULL OR star_rating BETWEEN 1 AND 5)
) ENGINE = InnoDB;

CREATE TABLE hotel_amenities (
    hotel_id   BINARY(16) NOT NULL,
    amenity_id BINARY(16) NOT NULL,
    PRIMARY KEY (hotel_id, amenity_id),
    CONSTRAINT fk_hotel_amenities_hotel FOREIGN KEY (hotel_id) REFERENCES hotels (id) ON DELETE CASCADE,
    CONSTRAINT fk_hotel_amenities_amenity FOREIGN KEY (amenity_id) REFERENCES amenities (id)
) ENGINE = InnoDB;

CREATE TABLE hotel_policies (
    id          BINARY(16)   NOT NULL,
    hotel_id    BINARY(16)   NOT NULL,
    policy_type VARCHAR(20)  NOT NULL COMMENT 'CHILDREN, PETS, SMOKING, ID_REQUIRED, PAYMENT, OTHER',
    description VARCHAR(1000) NOT NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_hotel_policies_hotel (hotel_id),
    CONSTRAINT fk_hotel_policies_hotel FOREIGN KEY (hotel_id) REFERENCES hotels (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Users who may manage a hotel (hotel managers; admins manage every hotel through their permission).
CREATE TABLE hotel_staff (
    hotel_id    BINARY(16)  NOT NULL,
    user_id     BINARY(16)  NOT NULL,
    staff_role  VARCHAR(20) NOT NULL DEFAULT 'MANAGER',
    assigned_at DATETIME(6) NOT NULL,
    assigned_by VARCHAR(64) NOT NULL,
    PRIMARY KEY (hotel_id, user_id),
    KEY idx_hotel_staff_user (user_id),
    CONSTRAINT fk_hotel_staff_hotel FOREIGN KEY (hotel_id) REFERENCES hotels (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE room_types (
    id                BINARY(16)   NOT NULL,
    hotel_id          BINARY(16)   NOT NULL,
    name              VARCHAR(100) NOT NULL,
    description       VARCHAR(2000) NULL,
    max_adults        INT          NOT NULL,
    max_children      INT          NOT NULL DEFAULT 0,
    bed_configuration VARCHAR(100) NOT NULL COMMENT 'e.g. 1 King bed',
    size_sqm          INT          NULL,
    total_rooms       INT          NOT NULL COMMENT 'default rooms for sale per night',
    status            VARCHAR(10)  NOT NULL COMMENT 'ACTIVE, INACTIVE',
    sort_order        INT          NOT NULL DEFAULT 0,
    created_at        DATETIME(6)  NOT NULL,
    updated_at        DATETIME(6)  NOT NULL,
    created_by        VARCHAR(64)  NOT NULL,
    updated_by        VARCHAR(64)  NOT NULL,
    version           BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_room_types_hotel (hotel_id),
    CONSTRAINT fk_room_types_hotel FOREIGN KEY (hotel_id) REFERENCES hotels (id),
    CONSTRAINT ck_room_types_capacity CHECK (max_adults BETWEEN 1 AND 10 AND max_children BETWEEN 0 AND 10),
    CONSTRAINT ck_room_types_total CHECK (total_rooms BETWEEN 0 AND 5000)
) ENGINE = InnoDB;

CREATE TABLE room_type_amenities (
    room_type_id BINARY(16) NOT NULL,
    amenity_id   BINARY(16) NOT NULL,
    PRIMARY KEY (room_type_id, amenity_id),
    CONSTRAINT fk_room_type_amenities_room FOREIGN KEY (room_type_id) REFERENCES room_types (id) ON DELETE CASCADE,
    CONSTRAINT fk_room_type_amenities_amenity FOREIGN KEY (amenity_id) REFERENCES amenities (id)
) ENGINE = InnoDB;

CREATE TABLE hotel_images (
    id           BINARY(16)   NOT NULL,
    hotel_id     BINARY(16)   NOT NULL,
    room_type_id BINARY(16)   NULL COMMENT 'NULL = hotel photo',
    storage_key  VARCHAR(255) NOT NULL COMMENT 'large version (max 1600 px)',
    thumb_key    VARCHAR(255) NOT NULL COMMENT 'thumbnail (max 480 px)',
    caption      VARCHAR(200) NULL,
    sort_order   INT          NOT NULL DEFAULT 0,
    is_cover     BOOLEAN      NOT NULL DEFAULT FALSE,
    width        INT          NOT NULL,
    height       INT          NOT NULL,
    created_at   DATETIME(6)  NOT NULL,
    created_by   VARCHAR(64)  NOT NULL,
    PRIMARY KEY (id),
    KEY idx_hotel_images_hotel (hotel_id, sort_order),
    CONSTRAINT fk_hotel_images_hotel FOREIGN KEY (hotel_id) REFERENCES hotels (id) ON DELETE CASCADE,
    CONSTRAINT fk_hotel_images_room FOREIGN KEY (room_type_id) REFERENCES room_types (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- A way to sell a room type: price, meals and cancellation terms.
-- Cancellation is kept on the plan (free until N hours before check-in, then a % fee) instead of separate
-- policy/rule tables: it covers the common hotel policies and keeps the manager screens simple.
CREATE TABLE rate_plans (
    id                         BINARY(16)    NOT NULL,
    room_type_id               BINARY(16)    NOT NULL,
    name                       VARCHAR(100)  NOT NULL,
    base_price_per_night       DECIMAL(12, 2) NOT NULL,
    currency                   CHAR(3)       NOT NULL DEFAULT 'INR',
    breakfast_included         BOOLEAN       NOT NULL DEFAULT FALSE,
    refundable                 BOOLEAN       NOT NULL,
    free_cancellation_hours    INT           NULL COMMENT 'free until this many hours before check-in; NULL if non-refundable',
    cancellation_fee_percent   DECIMAL(5, 2) NOT NULL COMMENT '% of the total charged after the free period (100 = non-refundable)',
    status                     VARCHAR(10)   NOT NULL COMMENT 'ACTIVE, INACTIVE',
    created_at                 DATETIME(6)   NOT NULL,
    updated_at                 DATETIME(6)   NOT NULL,
    created_by                 VARCHAR(64)   NOT NULL,
    updated_by                 VARCHAR(64)   NOT NULL,
    version                    BIGINT        NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_rate_plans_room (room_type_id),
    CONSTRAINT fk_rate_plans_room FOREIGN KEY (room_type_id) REFERENCES room_types (id),
    CONSTRAINT ck_rate_plans_price CHECK (base_price_per_night > 0),
    CONSTRAINT ck_rate_plans_fee CHECK (cancellation_fee_percent BETWEEN 0 AND 100)
) ENGINE = InnoDB;

-- Seasonal prices: override the base price on the covered nights. Higher priority wins when periods overlap.
CREATE TABLE room_rates (
    id              BINARY(16)     NOT NULL,
    rate_plan_id    BINARY(16)     NOT NULL,
    label           VARCHAR(80)    NOT NULL COMMENT 'e.g. Christmas week',
    start_date      DATE           NOT NULL,
    end_date        DATE           NOT NULL COMMENT 'inclusive (last night at this price)',
    price_per_night DECIMAL(12, 2) NOT NULL,
    priority        INT            NOT NULL DEFAULT 0,
    created_at      DATETIME(6)    NOT NULL,
    created_by      VARCHAR(64)    NOT NULL,
    PRIMARY KEY (id),
    KEY idx_room_rates_plan_dates (rate_plan_id, start_date, end_date),
    CONSTRAINT fk_room_rates_plan FOREIGN KEY (rate_plan_id) REFERENCES rate_plans (id) ON DELETE CASCADE,
    CONSTRAINT ck_room_rates_dates CHECK (end_date >= start_date),
    CONSTRAINT ck_room_rates_price CHECK (price_per_night > 0)
) ENGINE = InnoDB;

-- One row per room type per night. Overbooking is impossible: holds use an atomic conditional UPDATE and the
-- CHECK below is the last line of defence.
CREATE TABLE room_inventory (
    id           BINARY(16) NOT NULL,
    room_type_id BINARY(16) NOT NULL,
    stay_date    DATE       NOT NULL,
    total_rooms  INT        NOT NULL,
    booked_rooms INT        NOT NULL DEFAULT 0,
    held_rooms   INT        NOT NULL DEFAULT 0,
    stop_sell    BOOLEAN    NOT NULL DEFAULT FALSE,
    version      BIGINT     NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_room_inventory_day (room_type_id, stay_date),
    KEY idx_room_inventory_date (stay_date),
    CONSTRAINT fk_room_inventory_room FOREIGN KEY (room_type_id) REFERENCES room_types (id),
    CONSTRAINT ck_room_inventory_counts CHECK (
        total_rooms >= 0 AND booked_rooms >= 0 AND held_rooms >= 0 AND booked_rooms + held_rooms <= total_rooms)
) ENGINE = InnoDB;

-- Reference points for "distance from" (city centre, airport, beach, ...).
CREATE TABLE landmarks (
    id           BINARY(16)    NOT NULL,
    city         VARCHAR(100)  NOT NULL,
    name         VARCHAR(120)  NOT NULL,
    landmark_type VARCHAR(20)  NOT NULL COMMENT 'CITY_CENTRE, AIRPORT, STATION, BEACH, ATTRACTION',
    latitude     DECIMAL(9, 6) NOT NULL,
    longitude    DECIMAL(9, 6) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_landmarks_city (city)
) ENGINE = InnoDB;

-- Local copy of user accounts from identity-service (identity.events), used to assign hotel managers by email.
CREATE TABLE known_users (
    user_id    BINARY(16)   NOT NULL,
    email      VARCHAR(254) NOT NULL,
    first_name VARCHAR(80)  NOT NULL,
    last_name  VARCHAR(80)  NOT NULL,
    roles      VARCHAR(200) NOT NULL COMMENT 'comma separated',
    status     VARCHAR(30)  NOT NULL,
    updated_at DATETIME(6)  NOT NULL,
    PRIMARY KEY (user_id),
    UNIQUE KEY uk_known_users_email (email)
) ENGINE = InnoDB;
