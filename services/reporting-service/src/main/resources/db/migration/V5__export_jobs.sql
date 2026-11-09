-- Background exports (requested 2026-11-09): an admin asks for every matching audit log entry as Excel or CSV; a job
-- writes the file on the server (any number of rows, Excel in parts of up to 1,000,000 rows), the admin is told when it
-- is ready and downloads it once through a short-lived link. API_DOCUMENTATION.md section 11.

CREATE TABLE export_jobs (
    id              BINARY(16)    NOT NULL,
    dataset         VARCHAR(30)   NOT NULL COMMENT 'AUDIT_LOGS',
    format          VARCHAR(10)   NOT NULL COMMENT 'XLSX or CSV',
    filters         JSON          NOT NULL COMMENT 'the list filters as asked (ids and codes only)',
    as_of           DATETIME(6)   NOT NULL COMMENT 'entries recorded after this are not included',
    requested_by    VARCHAR(64)   NOT NULL COMMENT 'user id of the admin',
    requested_by_name VARCHAR(200) NULL COMMENT 'shown in the file as "Exported by"',
    status          VARCHAR(20)   NOT NULL COMMENT 'QUEUED, RUNNING, READY, FAILED, EXPIRED (a removed job is deleted)',
    total_rows      BIGINT        NULL,
    rows_written    BIGINT        NOT NULL DEFAULT 0,
    parts           INT           NULL COMMENT 'number of files (Excel parts); more than 1 = a .zip',
    storage_key     VARCHAR(100)  NULL,
    file_name       VARCHAR(200)  NULL,
    size_bytes      BIGINT        NULL,
    error           VARCHAR(300)  NULL COMMENT 'safe to show to the admin',
    link_token_hash CHAR(64)      NULL COMMENT 'SHA-256 of the one-time download token',
    link_expires_at DATETIME(6)   NULL,
    created_at      DATETIME(6)   NOT NULL,
    started_at      DATETIME(6)   NULL,
    heartbeat_at    DATETIME(6)   NULL,
    finished_at     DATETIME(6)   NULL,
    expires_at      DATETIME(6)   NULL COMMENT 'the file is deleted after this',
    PRIMARY KEY (id),
    KEY idx_export_jobs_requester (requested_by, created_at),
    KEY idx_export_jobs_status (status, heartbeat_at)
) ENGINE = InnoDB;
