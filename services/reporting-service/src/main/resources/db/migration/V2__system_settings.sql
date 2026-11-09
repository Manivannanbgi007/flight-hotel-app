-- System settings: owned by reporting-service, broadcast to every service through Kafka (settings.events).
CREATE TABLE system_settings (
    setting_key       VARCHAR(100)  NOT NULL,
    setting_value     VARCHAR(2000) NULL,
    value_type        VARCHAR(20)   NOT NULL COMMENT 'STRING, INTEGER, DECIMAL, BOOLEAN, DURATION',
    description       VARCHAR(500)  NOT NULL,
    is_public         BOOLEAN       NOT NULL DEFAULT FALSE COMMENT 'readable without login (e.g. support phone)',
    published_version BIGINT        NOT NULL DEFAULT -1 COMMENT 'last version written to the outbox',
    version           BIGINT        NOT NULL DEFAULT 0,
    created_at        DATETIME(6)   NOT NULL,
    updated_at        DATETIME(6)   NOT NULL,
    created_by        VARCHAR(64)   NOT NULL,
    updated_by        VARCHAR(64)   NOT NULL,
    PRIMARY KEY (setting_key)
) ENGINE = InnoDB;

-- Defaults. Every service also has a safe built-in default for each key.
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_public, created_at, updated_at, created_by, updated_by) VALUES
('site.name',                       'FlightHotel',              'STRING',   'Brand name shown in the UI and emails',                          TRUE,  UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM'),
('support.email',                   'support@flighthotel.local','STRING',   'Customer support email',                                         TRUE,  UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM'),
('support.phone',                   '+91 00000 00000',          'STRING',   'Customer support phone (placeholder, set the real number)',      TRUE,  UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM'),
('currency.default',                'INR',                      'STRING',   'Currency for prices and payments (v1 supports INR only)',        TRUE,  UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM'),
('booking.payment-window-minutes',  '15',                       'INTEGER',  'Minutes a customer has to pay after inventory is held',          FALSE, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM'),
('booking.hold-grace-minutes',      '5',                        'INTEGER',  'Extra minutes inventory stays held after the payment window',    FALSE, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM'),
('booking.max-flight-passengers',   '9',                        'INTEGER',  'Maximum passengers in one flight booking',                       TRUE,  UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM'),
('hotel.gst.threshold-per-night',   '7500',                     'DECIMAL',  'Room price per night (INR) that separates the two GST rates. Confirm with your tax advisor.', FALSE, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM'),
('hotel.gst.rate-up-to-threshold',  '5',                        'DECIMAL',  'GST % for rooms up to the threshold. Confirm with your tax advisor.',   FALSE, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM'),
('hotel.gst.rate-above-threshold',  '18',                       'DECIMAL',  'GST % for rooms above the threshold. Confirm with your tax advisor.',   FALSE, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM'),
('reviews.require-moderation',      'true',                     'BOOLEAN',  'New reviews need admin approval before they are shown',          FALSE, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM'),
('notifications.travel-reminder-hours', '24',                   'INTEGER',  'Hours before travel to send the reminder',                       FALSE, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM');
