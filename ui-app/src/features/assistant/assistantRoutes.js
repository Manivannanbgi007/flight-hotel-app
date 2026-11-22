import { hasAnyRole } from '@/lib/auth/types';
import { canOpenPath } from '@/lib/auth/redirects';

export const ASSISTANT_ROUTES = {
  // Customer
  MY_TRIPS: { role: 'CUSTOMER', path: '/my-trips', search: true },
  PAYMENTS: { role: 'CUSTOMER', path: '/account/payments' },
  NOTIFICATIONS: { role: 'CUSTOMER', path: '/account/notifications' },
  SUPPORT: { role: 'CUSTOMER', path: '/account/support' },
  NEW_TICKET: { role: 'CUSTOMER', path: '/account/support/new' },
  PROFILE: { role: 'CUSTOMER', path: '/account/profile' },
  PASSENGERS: { role: 'CUSTOMER', path: '/account/passengers' },
  PREFERENCES: { role: 'CUSTOMER', path: '/account/preferences' },
  SECURITY: { role: 'CUSTOMER', path: '/account/security' },
  MY_REVIEWS: { role: 'CUSTOMER', path: '/account/reviews' },
  CUSTOMER_DASHBOARD: { role: 'CUSTOMER', path: '/customer/dashboard' },
  OFFERS: { role: 'CUSTOMER', path: '/offers' },
  HOTEL_SEARCH: { role: 'CUSTOMER', path: '/hotels' },
  FLIGHT_SEARCH: { role: 'CUSTOMER', path: '/flights' },
  // Admin
  ADMIN_DASHBOARD: { role: 'ADMIN', path: '/admin' },
  ADMIN_BOOKINGS: { role: 'ADMIN', path: '/admin/bookings' },
  ADMIN_PAYMENTS: { role: 'ADMIN', path: '/admin/payments' },
  ADMIN_REFUNDS: { role: 'ADMIN', path: '/admin/refunds' },
  ADMIN_REPORTS: { role: 'ADMIN', path: '/admin/reports' },
  ADMIN_SUPPORT: { role: 'ADMIN', path: '/admin/support' },
  ADMIN_USERS: { role: 'ADMIN', path: '/admin/users' },
  ADMIN_HOTELS: { role: 'ADMIN', path: '/admin/hotels' },
  // Hotel manager
  HOTEL_HOME: { role: 'HOTEL_MANAGER', path: '/hotel-manager' },
  HOTEL_DASHBOARD: { role: 'HOTEL_MANAGER', hotelPage: 'dashboard' },
  HOTEL_RESERVATIONS: { role: 'HOTEL_MANAGER', hotelPage: 'reservations' },
  HOTEL_ROOMS: { role: 'HOTEL_MANAGER', hotelPage: 'rooms' },
  HOTEL_INVENTORY: { role: 'HOTEL_MANAGER', hotelPage: 'inventory' },
  HOTEL_REVIEWS: { role: 'HOTEL_MANAGER', hotelPage: 'reviews' },
  HOTEL_REPORTS: { role: 'HOTEL_MANAGER', hotelPage: 'reports' },
  HOTEL_PROFILE: { role: 'HOTEL_MANAGER', hotelPage: 'profile' },
  HOTEL_PHOTOS: { role: 'HOTEL_MANAGER', hotelPage: 'photos' },
  // Support agent
  SUPPORT_HOME: { role: 'SUPPORT_AGENT', path: '/support' },
  SUPPORT_TICKETS: { role: 'SUPPORT_AGENT', path: '/support/tickets' },
  SUPPORT_BOOKINGS: { role: 'SUPPORT_AGENT', path: '/support/bookings' },
  SUPPORT_ATTENTION: { role: 'SUPPORT_AGENT', path: '/support/attention' },
};

/** Does a path start with a single "/" and stay inside the app (no scheme, no host, no backslash or control character)? */
function isInternalPath(path) {
  return (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    ![...path].some((char) => char === '\\' || char.charCodeAt(0) < 0x20)
  );
}

/**
 * The page of a button, or null when it must not be shown: unknown key, a role that may not see it, or a hotel page
 * without a hotel of the manager's own (`hotels` = the manager's hotels, or undefined while they load).
 * One hotel and no name: that hotel. Several hotels and no name: the hotel list, where they choose.
 */
export function resolveAction(action, user, hotels) {
  const entry = Object.hasOwn(ASSISTANT_ROUTES, action.route) ? ASSISTANT_ROUTES[action.route] : undefined;
  if (!entry || !user || !hasAnyRole(user, [entry.role])) return null;

  let path = null;
  let label = action.label;
  if (entry.path) {
    path = entry.path;
    if (entry.search && action.query && /^[A-Z]{2}-[A-Z0-9]{8}$/.test(action.query)) {
      path += `?q=${encodeURIComponent(action.query)}`;
    }
  } else if (entry.hotelPage) {
    if (!hotels) return null;
    const wanted = action.hotel?.trim().toLowerCase();
    const hotel = wanted
      ? hotels.find((candidate) => candidate.name.trim().toLowerCase() === wanted)
      : hotels.length === 1
        ? hotels[0]
        : undefined;
    if (hotel) {
      path = `/hotel-manager/hotels/${encodeURIComponent(hotel.id)}/${entry.hotelPage}`;
    } else if (!wanted && hotels.length > 1) {
      path = '/hotel-manager';
      label = 'Choose a hotel';
    }
    // A name that is none of the manager's hotels gives no button at all.
  }
  if (!path || !isInternalPath(path) || !canOpenPath(user, path)) return null;
  return { label, icon: action.icon, to: path };
}

/** True when any of the actions opens a hotel page (the hotel list is then needed). */
export function needsHotels(actions) {
  return actions.some((action) => !!ASSISTANT_ROUTES[action.route]?.hotelPage);
}
