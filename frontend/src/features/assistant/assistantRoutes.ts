import type { Role } from '@/lib/auth/types';
import { hasAnyRole, type AuthUser } from '@/lib/auth/types';
import { canOpenPath } from '@/lib/auth/redirects';
import type { ChatAction } from './blocks';

/**
 * The pages an assistant button may open: an allowlist of route KEYS (the server's `Route` enum) mapped to this app's own
 * paths. The assistant never supplies a path or a URL, so there is nothing to follow outside this table. Each key names
 * the role that may see it; the user's role is checked again here and by the router's own guards.
 *
 * Hotel pages need a hotel id. It is never taken from the assistant: the button carries the hotel's NAME (from a tool
 * result) and the id is looked up in the signed-in manager's own hotel list (`GET /api/hotel-manager/hotels`, which only
 * returns hotels assigned to them).
 */
interface RouteEntry {
  role: Role;
  /** Path of a page that is not hotel specific; with `hotelPage` the page below `/hotel-manager/hotels/{id}/`. */
  path?: string;
  hotelPage?: string;
  /** Pages that take a booking reference as their search word (`?q=`). */
  search?: boolean;
}

export const ASSISTANT_ROUTES: Record<string, RouteEntry> = {
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

/** A hotel of the signed-in manager (the id comes from the API, not from the assistant). */
export interface ManagedHotel {
  id: string;
  name: string;
}

export interface ResolvedAction {
  label: string;
  icon: string;
  /** A path inside this app, ready for React Router's `navigate`. */
  to: string;
}

/** Does a path start with a single "/" and stay inside the app (no scheme, no host, no backslash or control character)? */
function isInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && ![...path].some((char) => char === '\\' || char.charCodeAt(0) < 0x20);
}

/**
 * The page of a button, or null when it must not be shown: unknown key, a role that may not see it, or a hotel page
 * without a hotel of the manager's own (`hotels` = the manager's hotels, or undefined while they load).
 * One hotel and no name: that hotel. Several hotels and no name: the hotel list, where they choose.
 */
export function resolveAction(action: ChatAction, user: Pick<AuthUser, 'roles'> | null, hotels: readonly ManagedHotel[] | undefined): ResolvedAction | null {
  const entry = Object.hasOwn(ASSISTANT_ROUTES, action.route) ? ASSISTANT_ROUTES[action.route] : undefined;
  if (!entry || !user || !hasAnyRole(user, [entry.role])) return null;

  let path: string | null = null;
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
      : hotels.length === 1 ? hotels[0] : undefined;
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
export function needsHotels(actions: readonly ChatAction[]): boolean {
  return actions.some((action) => !!ASSISTANT_ROUTES[action.route]?.hotelPage);
}
