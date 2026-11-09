-- Phase 9: guest reviews (API_DOCUMENTATION.md §14.4). One review per stay (booking). Only APPROVED reviews are
-- public and count towards the hotel's rating. Review photos are not supported (reviews.photos.enabled = false).

-- The demo catalogue was created with made-up rating figures ("4.4 from 312 reviews"). They are kept apart, so the
-- hotel's rating can always be recalculated as "these figures + the approved reviews written here".
ALTER TABLE hotels
    MODIFY avg_rating DECIMAL(2, 1) NULL COMMENT '1.0-5.0: seed figures combined with approved reviews',
    MODIFY review_count INT NOT NULL DEFAULT 0 COMMENT 'seed_review_count + approved reviews',
    ADD COLUMN seed_rating       DECIMAL(2, 1) NULL COMMENT 'rating the hotel started with (demo data), 1.0-5.0' AFTER review_count,
    ADD COLUMN seed_review_count INT           NOT NULL DEFAULT 0 COMMENT 'number of reviews behind seed_rating' AFTER seed_rating;

UPDATE hotels SET seed_rating = avg_rating, seed_review_count = review_count;

CREATE TABLE reviews (
    id                BINARY(16)   NOT NULL,
    hotel_id          BINARY(16)   NOT NULL,
    reservation_id    BINARY(16)   NOT NULL,
    booking_id        BINARY(16)   NOT NULL COMMENT 'one review per stay',
    booking_reference VARCHAR(20)  NOT NULL,
    user_id           BINARY(16)   NOT NULL COMMENT 'the author',
    author_name       VARCHAR(80)  NOT NULL COMMENT 'shown publicly, e.g. "Asha R." (taken when the review is written)',
    stayed_on         DATE         NOT NULL COMMENT 'check-in date of the stay, shown as month and year',
    rating            INT          NOT NULL,
    title             VARCHAR(100) NOT NULL,
    body              TEXT         NOT NULL,
    status            VARCHAR(10)  NOT NULL COMMENT 'PENDING, APPROVED, REJECTED',
    rejection_reason  VARCHAR(300) NULL COMMENT 'shown to the author',
    moderated_at      DATETIME(6)  NULL,
    moderated_by      VARCHAR(64)  NULL,
    created_at        DATETIME(6)  NOT NULL,
    updated_at        DATETIME(6)  NOT NULL,
    created_by        VARCHAR(64)  NOT NULL,
    updated_by        VARCHAR(64)  NOT NULL,
    version           BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_reviews_booking (booking_id),
    KEY idx_reviews_hotel_status (hotel_id, status, created_at),
    KEY idx_reviews_user (user_id, created_at),
    KEY idx_reviews_status (status, created_at),
    CONSTRAINT fk_reviews_hotel FOREIGN KEY (hotel_id) REFERENCES hotels (id),
    CONSTRAINT fk_reviews_reservation FOREIGN KEY (reservation_id) REFERENCES hotel_reservations (id),
    CONSTRAINT ck_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE = InnoDB;

-- "This review is inappropriate": one report per user and review. OPEN reports put the review in the moderation
-- queue; approving or rejecting the review closes them (kept for the record).
CREATE TABLE review_reports (
    id          BINARY(16)   NOT NULL,
    review_id   BINARY(16)   NOT NULL,
    reporter_id BINARY(16)   NOT NULL,
    reason      VARCHAR(300) NOT NULL,
    status      VARCHAR(10)  NOT NULL COMMENT 'OPEN, CLOSED (a moderator decided on the review)',
    created_at  DATETIME(6)  NOT NULL,
    closed_at   DATETIME(6)  NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_review_reports_reporter (review_id, reporter_id),
    KEY idx_review_reports_open (status, review_id),
    CONSTRAINT fk_review_reports_review FOREIGN KEY (review_id) REFERENCES reviews (id) ON DELETE CASCADE
) ENGINE = InnoDB;
