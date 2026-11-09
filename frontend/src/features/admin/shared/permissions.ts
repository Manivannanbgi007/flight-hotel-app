import { useAuth } from '@/app/providers/useAuth';
import { hasPermission, type Permission } from '@/lib/auth/types';

/** The current user has `permission` (admins have them all; the API checks again). Hidden actions stay hidden. */
export function useCan(permission: Permission): boolean {
  const { user } = useAuth();
  return hasPermission(user, permission);
}

/** Every permission identity-service gives the ADMIN role (V3__roles_and_permissions.sql). */
export const ADMIN_PERMISSIONS: readonly Permission[] = [
  'USER_READ_ANY',
  'USER_MANAGE',
  'BOOKING_READ_ANY',
  'BOOKING_MANAGE_ANY',
  'PAYMENT_READ_ANY',
  'REFUND_MANAGE',
  'HOTEL_MANAGE_ANY',
  'FLIGHT_PROVIDER_MANAGE',
  'REVIEW_MODERATE',
  'COUPON_MANAGE',
  'SUPPORT_TICKET_MANAGE',
  'REPORT_VIEW',
  'AUDIT_VIEW',
  'SETTINGS_MANAGE',
];
