-- The four roles and their fine-grained permissions. Services check roles with hasRole('X') and
-- permissions with hasAuthority('X'); both are written into the access token.

INSERT INTO roles (id, name, description) VALUES
(UUID_TO_BIN(UUID()), 'CUSTOMER',      'Books flights and hotels'),
(UUID_TO_BIN(UUID()), 'ADMIN',         'Manages the whole system'),
(UUID_TO_BIN(UUID()), 'HOTEL_MANAGER', 'Manages assigned hotels'),
(UUID_TO_BIN(UUID()), 'SUPPORT_AGENT', 'Helps customers with bookings');

INSERT INTO permissions (id, code, description) VALUES
(UUID_TO_BIN(UUID()), 'USER_READ_ANY',          'View any user account'),
(UUID_TO_BIN(UUID()), 'USER_MANAGE',            'Create, activate, deactivate users and change roles'),
(UUID_TO_BIN(UUID()), 'BOOKING_READ_ANY',       'View any booking'),
(UUID_TO_BIN(UUID()), 'BOOKING_MANAGE_ANY',     'Change or cancel any booking'),
(UUID_TO_BIN(UUID()), 'PAYMENT_READ_ANY',       'View any payment'),
(UUID_TO_BIN(UUID()), 'REFUND_MANAGE',          'Approve and process refunds'),
(UUID_TO_BIN(UUID()), 'HOTEL_MANAGE_ANY',       'Manage every hotel'),
(UUID_TO_BIN(UUID()), 'HOTEL_MANAGE_ASSIGNED',  'Manage hotels assigned to the user'),
(UUID_TO_BIN(UUID()), 'FLIGHT_PROVIDER_MANAGE', 'Enable and configure flight providers'),
(UUID_TO_BIN(UUID()), 'REVIEW_MODERATE',        'Approve or reject reviews'),
(UUID_TO_BIN(UUID()), 'COUPON_MANAGE',          'Manage offers and coupons'),
(UUID_TO_BIN(UUID()), 'SUPPORT_TICKET_MANAGE',  'Handle support tickets'),
(UUID_TO_BIN(UUID()), 'REPORT_VIEW',            'View dashboards and reports'),
(UUID_TO_BIN(UUID()), 'AUDIT_VIEW',             'View audit logs'),
(UUID_TO_BIN(UUID()), 'SETTINGS_MANAGE',        'Change system settings');

-- ADMIN: everything except the hotel-manager-only permission.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'ADMIN' AND p.code <> 'HOTEL_MANAGE_ASSIGNED';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'HOTEL_MANAGER' AND p.code IN ('HOTEL_MANAGE_ASSIGNED');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'SUPPORT_AGENT'
  AND p.code IN ('BOOKING_READ_ANY', 'BOOKING_MANAGE_ANY', 'PAYMENT_READ_ANY', 'SUPPORT_TICKET_MANAGE', 'USER_READ_ANY');
