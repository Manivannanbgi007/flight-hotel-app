import { matchRoutes } from 'react-router';

import { routes } from '@/app/router';
import type { AuthUser } from '@/lib/auth/types';
import { admin, customer } from '@/test/renderRoutes';
import { ASSISTANT_ROUTES, needsHotels, resolveAction } from './assistantRoutes';
import type { ChatAction } from './blocks';

const manager: AuthUser = { ...customer, id: 'm1', roles: ['HOTEL_MANAGER'] };
const agent: AuthUser = { ...customer, id: 's1', roles: ['SUPPORT_AGENT'] };
const action = (route: string, extra: Partial<ChatAction> = {}): ChatAction => ({ route, label: route, icon: '', hotel: null, query: null, ...extra });
const hotels = [{ id: 'h-1', name: 'Sea Breeze Resort' }, { id: 'h-2', name: 'Hill View Inn' }];

describe('the assistant route allowlist', () => {
  it('only points at pages that exist in the router (no broken buttons)', () => {
    for (const [key, entry] of Object.entries(ASSISTANT_ROUTES)) {
      const path = entry.path ?? `/hotel-manager/hotels/some-id/${entry.hotelPage}`;
      const matches = matchRoutes(routes, path) ?? [];
      const last = matches.at(-1)?.route;
      // The catch-all 404 routes ('*') do not count as a page.
      expect(last && last.path !== '*', `${key} → ${path}`).toBe(true);
    }
  });

  it('shows a customer only customer pages, an admin admin pages, a manager hotel pages, an agent support pages', () => {
    expect(resolveAction(action('PAYMENTS'), customer, undefined)?.to).toBe('/account/payments');
    expect(resolveAction(action('PAYMENTS', { label: 'View All Payments' }), customer, undefined)?.label).toBe('View All Payments');
    expect(resolveAction(action('ADMIN_PAYMENTS'), customer, undefined)).toBeNull();
    expect(resolveAction(action('ADMIN_PAYMENTS'), admin, undefined)?.to).toBe('/admin/payments');
    expect(resolveAction(action('PAYMENTS'), admin, undefined)).toBeNull();
    expect(resolveAction(action('SUPPORT_TICKETS'), agent, undefined)?.to).toBe('/support/tickets');
    expect(resolveAction(action('SUPPORT_TICKETS'), customer, undefined)).toBeNull();
    expect(resolveAction(action('PROFILE'), null, undefined)).toBeNull();
  });

  it('drops keys that are not on the list, including paths and URLs', () => {
    for (const route of ['https://evil.example/', '//evil.example', '/admin/users', 'javascript:alert(1)', 'toString', '__proto__', '']) {
      expect(resolveAction(action(route), admin, hotels), route).toBeNull();
    }
  });

  it('opens My Trips with a booking reference as the search word, and ignores anything else', () => {
    expect(resolveAction(action('MY_TRIPS', { query: 'HT-7K3M9Q2X' }), customer, undefined)?.to).toBe('/my-trips?q=HT-7K3M9Q2X');
    expect(resolveAction(action('MY_TRIPS', { query: '"><script>' }), customer, undefined)?.to).toBe('/my-trips');
    expect(resolveAction(action('PAYMENTS', { query: 'HT-7K3M9Q2X' }), customer, undefined)?.to).toBe('/account/payments');
  });

  it('finds the hotel id in the manager\'s own hotels, never from the assistant', () => {
    expect(resolveAction(action('HOTEL_RESERVATIONS', { hotel: 'hill view inn' }), manager, hotels)?.to)
      .toBe('/hotel-manager/hotels/h-2/reservations');
    expect(resolveAction(action('HOTEL_ROOMS', { hotel: 'Sea Breeze Resort' }), manager, hotels)?.to).toBe('/hotel-manager/hotels/h-1/rooms');
    // A hotel that is not theirs gives no button; the hotels are still loading: none yet.
    expect(resolveAction(action('HOTEL_INVENTORY', { hotel: 'Somebody Else\'s Hotel' }), manager, hotels)).toBeNull();
    expect(resolveAction(action('HOTEL_INVENTORY', { hotel: 'Sea Breeze Resort' }), manager, undefined)).toBeNull();
    // No name: their only hotel, or the hotel list when they have several.
    expect(resolveAction(action('HOTEL_DASHBOARD'), manager, [hotels[0]!])?.to).toBe('/hotel-manager/hotels/h-1/dashboard');
    expect(resolveAction(action('HOTEL_DASHBOARD'), manager, hotels)).toMatchObject({ to: '/hotel-manager', label: 'Choose a hotel' });
    // A customer never gets a hotel page.
    expect(resolveAction(action('HOTEL_DASHBOARD', { hotel: 'Sea Breeze Resort' }), customer, hotels)).toBeNull();
  });

  it('knows which buttons need the manager\'s hotels', () => {
    expect(needsHotels([action('PAYMENTS')])).toBe(false);
    expect(needsHotels([action('PAYMENTS'), action('HOTEL_ROOMS')])).toBe(true);
  });
});
