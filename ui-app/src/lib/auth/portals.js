export const PORTALS = {
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

export const PORTAL_ORDER = ['CUSTOMER', 'HOTEL_MANAGER', 'ADMIN', 'SUPPORT'];

const AREA_PORTAL = {
  customer: 'CUSTOMER',
  admin: 'ADMIN',
  'hotel-manager': 'HOTEL_MANAGER',
  support: 'SUPPORT',
};

export function portalOfArea(area) {
  return PORTALS[AREA_PORTAL[area]];
}

/** `/admin/users` → admin, `/hotel-manager/...` → hotel-manager, `/support/...` → support, anything else → customer. */
export function areaOfPath(path) {
  const match = /^\/(admin|hotel-manager|support)(?=\/|\?|#|$)/.exec(path);
  return match?.[1] ?? 'customer';
}

/** `ADMIN`, `admin`, `hotel-manager`, `HOTEL_MANAGER`, ... → the portal; anything else → null. */
export function parsePortal(value) {
  if (!value) return null;
  const upper = value.trim().toUpperCase().replace(/-/g, '_');
  return PORTAL_ORDER.includes(upper) ? upper : null;
}

/** May this user use the portal? (The same rule as identity-service; the API checks it again on every request.) */
export function canUsePortal(user, portal) {
  return PORTALS[portal].roles.some((role) => user.roles.includes(role));
}

/** The portal a user normally works in: admins → admin, then hotel manager, support, customer. */
export function primaryPortal(user) {
  if (user.roles.includes('ADMIN')) return 'ADMIN';
  if (user.roles.includes('HOTEL_MANAGER')) return 'HOTEL_MANAGER';
  if (user.roles.includes('SUPPORT_AGENT')) return 'SUPPORT';
  return 'CUSTOMER';
}

/** `/admin/login?redirect=%2Fadmin%2Fusers&reason=...` */
export function signInPath(portal, query = {}) {
  const params = new URLSearchParams();
  if (query.redirect) params.set('redirect', query.redirect);
  if (query.reason) params.set('reason', query.reason);
  const search = params.toString();
  return search ? `${PORTALS[portal].signInPath}?${search}` : PORTALS[portal].signInPath;
}

/** Staff portals the user can open, by role (support agents' portal is also open to admins). */
export function portalLinks(user) {
  const links = [];
  if (user.roles.includes('ADMIN')) links.push({ to: '/admin', label: 'Admin portal' });
  if (user.roles.includes('HOTEL_MANAGER')) links.push({ to: '/hotel-manager', label: 'Hotel manager portal' });
  if (user.roles.includes('SUPPORT_AGENT') || user.roles.includes('ADMIN')) {
    links.push({ to: '/support', label: 'Support portal' });
  }
  return links;
}
