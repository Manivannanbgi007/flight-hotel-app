-- Phase 9: one-time jobs run at start-up by exactly one instance (the row is locked while it runs). The first one
-- publishes a UserSnapshot of every account for read models that start later (reporting-service).
CREATE TABLE data_backfills (
    name    VARCHAR(60) NOT NULL,
    done_at DATETIME(6) NULL,
    PRIMARY KEY (name)
) ENGINE = InnoDB;

INSERT INTO data_backfills (name) VALUES ('user-snapshots');
