-- One-time jobs run at start-up by exactly one instance (the row is locked while it runs). The first one publishes a
-- HotelReviewSnapshot of every existing review (hotel.events) for read models that start later (search-service).
CREATE TABLE IF NOT EXISTS data_backfills (
    name    VARCHAR(60) NOT NULL,
    done_at DATETIME(6) NULL,
    PRIMARY KEY (name)
) ENGINE = InnoDB;

INSERT INTO data_backfills (name) VALUES ('review-snapshots');
