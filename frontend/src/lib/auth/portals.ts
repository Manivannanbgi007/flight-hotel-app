import type { AuthUser, Role } from './types';

/**
 * The four sign-in portals (IMPLEMENTATION_PLAN.md §11.2). The login request names the portal it was sent from
 * (`POST /api/auth/login` `portal`); identity-service answers `403 PORTAL_NOT_ALLOWED` when the account has none of
 * the portal's roles, and the UI checks the same rule again after a successful login.
 */
export type Portal = 'CUSTOMER' | 'ADMIN' | 'HOTEL_MANAGER' | 'SUPPORT';

/** The part of the app a page belongs to (from its path): decides which sign-in page a visitor is sent to. */
export type Area = 'customer' | 'admin' | 'hotel-manager' | 'support';

export interface PortalInfo {
  portal: Portal;
  area: Area;
  /** `/admin/login` */
  signInPath: string;
  /** Where the portal starts after login (`/admin`). */
  home: string;
  /** "Admin portal" (headings, access-denied page). */
  label: string;
  /** Who the portal is for, as a sentence part: "administrators". */
  audience: string;
  /** "Hotel partner?" (before the link to this sign-in page on the other sign-in pages). */
  question: string;
  /** "Sign in to the partner portal" (link text to this sign-in page). */
  signInLabel: string;
  /** Roles that may sign in here (admins also hold the hotel manager and support permissions). */
  roles: readonly Role[];
}

export const PORTALS: Record<Portal, PortalInfo> = {
  CUSTOMER: {
    portal: 'CUSTOMER',
    area: 'customer',
    signInPath: '/customer/login',
    home: '/customer/dashboard',
    label: 'Customer account',
    audience: 'travellers with a customer account',
    question: 'Travelling with us?',
    signInLabel: 'Sign in as a customer',
    roles: ['CUSTOMER'],
  },
  ADMIN: {
    portal: 'ADMIN',
    area: 'admin',
    signInPath: '/admin/login',
    home: '/admin',
    label: 'Admin portal',
    audience: 'administrators',
    question: 'Administrator?',
    signInLabel: 'Sign in to the admin portal',
    roles: ['ADMIN'],
  },
  HOTEL_MANAGER: {
    portal: 'HOTEL_MANAGER',
    area: 'hotel-manager',
    signInPath: '/hotel-manager/login',
    home: '/hotel-manager',
    label: 'Hotel partner portal',
    audience: 'hotel managers',
    question: 'Hotel partner?',
    signInLabel: 'Sign in to the partner portal',
    roles: ['HOTEL_MANAGER', 'ADMIN'],
  },
  SUPPORT: {
    portal: 'SUPPORT',
    area: 'support',
    signInPath: '/support/login',
    home: '/support',
    label: 'Support portal',
    audience: 'support agents',
    question: 'Support agent?',
    signInLabel: 'Sign in to the support portal',
    roles: ['SUPPORT_AGENT', 'ADMIN'],
  },
};

export const PORTAL_ORDER: readonly Portal[] = ['CUSTOMER', 'HOTEL_MANAGER', 'ADMIN', 'SUPPORT'];

const AREA_PORTAL: Record<Area, Portal> = {
  customer: 'CUSTOMER',
  admin: 'ADMIN',
  'hotel-manager': 'HOTEL_MANAGER',
  support: 'SUPPORT',
};

export function portalOfArea(area: Area): PortalInfo {
  return PORTALS[AREA_PORTAL[area]];
}

/** `/admin/users` → admin, `/hotel-manager/...` → hotel-manager, `/support/...` → support, anything else → customer. */
export function areaOfPath(path: string): Area {
  const match = /^\/(admin|hotel-manager|support)(?=\/|\?|#|$)/.exec(path);
  return (match?.[1] as Area | undefined) ?? 'customer';
}

/** `ADMIN`, `admin`, `hotel-manager`, `HOTEL_MANAGER`, ... → the portal; anything else → null. */
export function parsePortal(value: string | null | undefined): Portal | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase().replace(/-/g, '_');
  return (PORTAL_ORDER as readonly string[]).includes(upper) ? (upper as Portal) : null;
}

/** May this user use the portal? (The same rule as identity-service; the API checks it again on every request.) */
export function canUsePortal(user: Pick<AuthUser, 'roles'>, portal: Portal): boolean {
  return PORTALS[portal].roles.some((role) => user.roles.includes(role));
}

/** The portal a user normally works in: admins → admin, then hotel manager, support, customer. */
export function primaryPortal(user: Pick<AuthUser, 'roles'>): Portal {
  if (user.roles.includes('ADMIN')) return 'ADMIN';
  if (user.roles.includes('HOTEL_MANAGER')) return 'HOTEL_MANAGER';
  if (user.roles.includes('SUPPORT_AGENT')) return 'SUPPORT';
  return 'CUSTOMER';
}

/** `/admin/login?redirect=%2Fadmin%2Fusers&reason=...` */
export function signInPath(portal: Portal, query: { redirect?: string | null; reason?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (query.redirect) params.set('redirect', query.redirect);
  if (query.reason) params.set('reason', query.reason);
  const search = params.toString();
  return search ? `${PORTALS[portal].signInPath}?${search}` : PORTALS[portal].signInPath;
}

export interface PortalLink {
  to: string;
  label: string;
}

/** Staff portals the user can open, by role (support agents' portal is also open to admins). */
export function portalLinks(user: Pick<AuthUser, 'roles'>): PortalLink[] {
  const links: PortalLink[] = [];
  if (user.roles.includes('ADMIN')) links.push({ to: '/admin', label: 'Admin portal' });
  if (user.roles.includes('HOTEL_MANAGER')) links.push({ to: '/hotel-manager', label: 'Hotel manager portal' });
  if (user.roles.includes('SUPPORT_AGENT') || user.roles.includes('ADMIN')) {
    links.push({ to: '/support', label: 'Support portal' });
  }
  return links;
}
