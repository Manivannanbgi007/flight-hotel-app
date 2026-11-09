/** Roles issued by identity-service (API_DOCUMENTATION.md, "Access token claims"). */
export type Role = 'CUSTOMER' | 'ADMIN' | 'HOTEL_MANAGER' | 'SUPPORT_AGENT';

/** Fine-grained permissions the UI checks (identity-service `permissions` table; the token carries them). */
export type Permission =
  | 'BOOKING_READ_ANY'
  | 'BOOKING_MANAGE_ANY'
  | 'PAYMENT_READ_ANY'
  | 'REFUND_MANAGE'
  | 'USER_READ_ANY'
  | 'USER_MANAGE'
  | 'HOTEL_MANAGE_ANY'
  | 'HOTEL_MANAGE_ASSIGNED'
  | 'FLIGHT_PROVIDER_MANAGE'
  | 'REVIEW_MODERATE'
  | 'COUPON_MANAGE'
  | 'SUPPORT_TICKET_MANAGE'
  | 'REPORT_VIEW'
  | 'AUDIT_VIEW'
  | 'SETTINGS_MANAGE';

/** The `user` object of an AuthResponse (login, refresh, change password). */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  permissions: string[];
  emailVerified: boolean;
  hasPhoto: boolean;
}

/** Body of `POST /api/auth/login`, `/api/auth/refresh` and `/api/customers/security/change-password`. */
export interface AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: AuthUser;
}

/** What the browser keeps in memory while someone is logged in. */
export interface Session {
  accessToken: string;
  user: AuthUser;
}

export function toSession(response: AuthResponse): Session {
  return { accessToken: response.accessToken, user: response.user };
}

/** True when the user has at least one of `roles`. */
export function hasAnyRole(user: Pick<AuthUser, 'roles'> | null | undefined, roles: readonly Role[]): boolean {
  return !!user && roles.some((role) => user.roles.includes(role));
}

/** True when the user has `permission`. Only shapes the UI: the API checks it again. */
export function hasPermission(user: Pick<AuthUser, 'permissions'> | null | undefined, permission: Permission): boolean {
  return !!user && user.permissions.includes(permission);
}
