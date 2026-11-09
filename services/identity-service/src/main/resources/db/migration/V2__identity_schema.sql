-- Identity: users, roles, permissions, tokens, saved passengers, preferences, signing keys.
-- IDs are UUID v7 stored as BINARY(16). Timestamps are UTC.

CREATE TABLE roles (
    id          BINARY(16)   NOT NULL,
    name        VARCHAR(40)  NOT NULL,
    description VARCHAR(255) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_roles_name (name)
) ENGINE = InnoDB;

CREATE TABLE permissions (
    id          BINARY(16)   NOT NULL,
    code        VARCHAR(60)  NOT NULL,
    description VARCHAR(255) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_permissions_code (code)
) ENGINE = InnoDB;

CREATE TABLE role_permissions (
    role_id       BINARY(16) NOT NULL,
    permission_id BINARY(16) NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id),
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id)
) ENGINE = InnoDB;

CREATE TABLE users (
    id                  BINARY(16)   NOT NULL,
    email               VARCHAR(254) NOT NULL COMMENT 'stored lower-case',
    password_hash       VARCHAR(100) NOT NULL COMMENT 'BCrypt, {bcrypt} prefix',
    first_name          VARCHAR(80)  NOT NULL,
    last_name           VARCHAR(80)  NOT NULL,
    phone               VARCHAR(20)  NULL,
    date_of_birth       DATE         NULL,
    nationality         CHAR(2)      NULL,
    profile_photo_key   VARCHAR(255) NULL,
    status              VARCHAR(30)  NOT NULL COMMENT 'PENDING_VERIFICATION, ACTIVE, DEACTIVATED',
    email_verified_at   DATETIME(6)  NULL,
    failed_login_count  INT          NOT NULL DEFAULT 0,
    locked_until        DATETIME(6)  NULL,
    last_login_at       DATETIME(6)  NULL,
    password_changed_at DATETIME(6)  NOT NULL,
    created_at          DATETIME(6)  NOT NULL,
    updated_at          DATETIME(6)  NOT NULL,
    created_by          VARCHAR(64)  NOT NULL,
    updated_by          VARCHAR(64)  NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_users_email (email),
    KEY idx_users_status (status),
    KEY idx_users_created_at (created_at)
) ENGINE = InnoDB;

CREATE TABLE user_roles (
    user_id BINARY(16) NOT NULL,
    role_id BINARY(16) NOT NULL,
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles (id)
) ENGINE = InnoDB;

-- Refresh tokens: only the SHA-256 hash is stored. family_id = one login session (rotation chain).
CREATE TABLE refresh_tokens (
    id             BINARY(16)   NOT NULL,
    user_id        BINARY(16)   NOT NULL,
    family_id      BINARY(16)   NOT NULL,
    token_hash     CHAR(64)     NOT NULL,
    remember_me    BOOLEAN      NOT NULL,
    expires_at     DATETIME(6)  NOT NULL,
    revoked_at     DATETIME(6)  NULL,
    revoke_reason  VARCHAR(30)  NULL COMMENT 'ROTATED, LOGOUT, LOGOUT_ALL, PASSWORD_CHANGED, PASSWORD_RESET, DEACTIVATED, REUSE_DETECTED',
    replaced_by_id BINARY(16)   NULL,
    ip_address     VARCHAR(45)  NULL,
    user_agent     VARCHAR(255) NULL,
    created_at     DATETIME(6)  NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_refresh_tokens_hash (token_hash),
    KEY idx_refresh_tokens_user (user_id, revoked_at),
    KEY idx_refresh_tokens_family (family_id),
    KEY idx_refresh_tokens_expires (expires_at),
    CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB;

CREATE TABLE email_verification_tokens (
    id         BINARY(16)  NOT NULL,
    user_id    BINARY(16)  NOT NULL,
    token_hash CHAR(64)    NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    used_at    DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_email_verification_tokens_hash (token_hash),
    KEY idx_email_verification_tokens_user (user_id, created_at),
    CONSTRAINT fk_email_verification_tokens_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB;

CREATE TABLE password_reset_tokens (
    id         BINARY(16)  NOT NULL,
    user_id    BINARY(16)  NOT NULL,
    token_hash CHAR(64)    NOT NULL,
    purpose    VARCHAR(30) NOT NULL COMMENT 'RESET_PASSWORD, ACCOUNT_INVITATION',
    expires_at DATETIME(6) NOT NULL,
    used_at    DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_password_reset_tokens_hash (token_hash),
    KEY idx_password_reset_tokens_user (user_id, created_at),
    CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB;

CREATE TABLE login_history (
    id             BINARY(16)   NOT NULL,
    user_id        BINARY(16)   NOT NULL,
    success        BOOLEAN      NOT NULL,
    failure_reason VARCHAR(40)  NULL,
    ip_address     VARCHAR(45)  NULL,
    user_agent     VARCHAR(255) NULL,
    occurred_at    DATETIME(6)  NOT NULL,
    PRIMARY KEY (id),
    KEY idx_login_history_user (user_id, occurred_at),
    KEY idx_login_history_occurred (occurred_at),
    CONSTRAINT fk_login_history_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB;

-- Passport numbers are encrypted (AES-256-GCM, see common-lib FieldEncryptor); passport_last4 is for display.
CREATE TABLE customer_passengers (
    id                  BINARY(16)   NOT NULL,
    user_id             BINARY(16)   NOT NULL,
    passenger_type      VARCHAR(10)  NOT NULL,
    first_name          VARCHAR(80)  NOT NULL,
    last_name           VARCHAR(80)  NOT NULL,
    date_of_birth       DATE         NULL,
    gender              VARCHAR(10)  NULL,
    nationality         CHAR(2)      NULL,
    passport_number_enc VARCHAR(255) NULL,
    passport_last4      CHAR(4)      NULL,
    passport_expiry     DATE         NULL,
    passport_country    CHAR(2)      NULL,
    created_at          DATETIME(6)  NOT NULL,
    updated_at          DATETIME(6)  NOT NULL,
    created_by          VARCHAR(64)  NOT NULL,
    updated_by          VARCHAR(64)  NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_customer_passengers_user (user_id),
    CONSTRAINT fk_customer_passengers_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB;

CREATE TABLE travel_preferences (
    user_id            BINARY(16)  NOT NULL,
    preferred_cabin    VARCHAR(20) NULL,
    home_airport       CHAR(3)     NULL,
    seat_preference    VARCHAR(20) NULL,
    meal_preference    VARCHAR(20) NULL,
    preferred_currency CHAR(3)     NOT NULL DEFAULT 'INR',
    newsletter_opt_in  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at         DATETIME(6) NOT NULL,
    updated_at         DATETIME(6) NOT NULL,
    created_by         VARCHAR(64) NOT NULL,
    updated_by         VARCHAR(64) NOT NULL,
    version            BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_travel_preferences_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB;

-- RSA keys that sign access tokens. The private key is encrypted with DATA_ENCRYPTION_KEY.
CREATE TABLE signing_keys (
    kid             CHAR(36)    NOT NULL,
    algorithm       VARCHAR(10) NOT NULL,
    public_key      TEXT        NOT NULL COMMENT 'base64 X.509 SubjectPublicKeyInfo',
    private_key_enc TEXT        NOT NULL COMMENT 'encrypted base64 PKCS#8',
    status          VARCHAR(10) NOT NULL COMMENT 'ACTIVE, RETIRED',
    created_at      DATETIME(6) NOT NULL,
    retired_at      DATETIME(6) NULL,
    PRIMARY KEY (kid),
    KEY idx_signing_keys_status (status)
) ENGINE = InnoDB;
