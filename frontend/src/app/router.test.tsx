import type { ComponentType } from 'react';
import { screen } from '@testing-library/react';
import { matchRoutes, type RouteObject } from 'react-router';

import { currentLocation, renderRoutes } from '@/test/renderRoutes';
import { routes } from './router';

/**
 * The route table of app/router.tsx: every lazy-loaded page must load, and the customer journey must reach the right
 * pages. (Who may open which portal is checked in roleNavigation.test.tsx.)
 */

interface LazyPage {
  path: string;
  load: () => Promise<{ Component?: ComponentType | null }>;
}

function lazyPages(tree: RouteObject[], parent = ''): LazyPage[] {
  return tree.flatMap((route) => {
    const path = route.index ? parent || '/' : [parent, route.path].filter(Boolean).join('/').replace(/\/+/g, '/');
    const own = typeof route.lazy === 'function'
      ? [{ path: path.startsWith('/') ? path : `/${path}`, load: route.lazy as LazyPage['load'] }]
      : [];
    return [...own, ...(route.children ? lazyPages(route.children, path) : [])];
  });
}

const pages = lazyPages(routes);

async function componentAt(path: string): Promise<string | undefined> {
  const page = pages.find((candidate) => candidate.path === path);
  return (await page?.load())?.Component?.name;
}

describe('route table', () => {
  it('loads a component for every lazy route', async () => {
    expect(pages.length).toBeGreaterThan(60);

    const failures: string[] = [];
    for (const page of pages) {
      const loaded = await page.load();
      if (typeof loaded.Component !== 'function') failures.push(page.path);
    }

    expect(failures).toEqual([]);
  }, 120_000);

  it.each([
    ['/hotels', 'HotelsLandingPage'],
    ['/hotels/search', 'HotelSearchPage'],
    ['/hotels/:slug', 'HotelDetailsPage'],
    ['/hotels/quote/:quoteId', 'HotelQuotePage'],
    ['/book/hotel/:quoteId', 'GuestDetailsPage'],
    ['/book/hotel/:quoteId/review', 'BookingReviewPage'],
    ['/flights/search', 'FlightSearchPage'],
    ['/book/flight/:tripOfferId', 'PassengerDetailsPage'],
    ['/my-trips/:bookingId/pay', 'PaymentPage'],
    ['/my-trips/:bookingId/result', 'PaymentResultPage'],
    ['/my-trips/:bookingId/cancel', 'CancelBookingPage'],
    ['/customer/login', 'CustomerLoginPage'],
    ['/admin/login', 'AdminLoginPage'],
    ['/hotel-manager/login', 'HotelManagerLoginPage'],
    ['/support/login', 'SupportLoginPage'],
    ['/customer/dashboard', 'CustomerDashboardPage'],
    ['/forgot-password', 'ForgotPasswordPage'],
    ['/account/security', 'SecurityPage'],
    ['/admin/hotels', 'AdminHotelsPage'],
    ['/hotel-manager/hotels/:hotelId/rooms', 'RoomsRatesPage'],
    ['/hotel-manager/hotels/:hotelId/inventory', 'InventoryCalendarPage'],
    ['/support/tickets/:ticketId', 'AgentTicketPage'],
  ])('%s opens %s', async (path, component) => {
    expect(await componentAt(path)).toBe(component);
  });
});

describe('home page address', () => {
  it('lives at /customer/home, inside the public layout (no sign-in needed)', () => {
    const matched = matchRoutes(routes, '/customer/home');
    expect(matched?.at(-1)?.route.path).toBe('customer/home');
    expect(matched?.some((match) => match.route.element && /Require(Auth|Role)/.test(String((match.route.element as { type?: { name?: string } }).type?.name)))).toBe(false);
  });

  it('sends / to /customer/home, keeping the query and the hash', async () => {
    const { router } = renderRoutes(routes, { path: '/?utm_source=mail#offers' });

    await vi.waitFor(() => expect(currentLocation(router)).toBe('/customer/home?utm_source=mail'), { timeout: 10_000 });
    expect(router.state.location.hash).toBe('#offers');
    expect(router.state.historyAction).toBe('REPLACE');
  }, 30_000);
});

describe('sign-in and portal routes', () => {
  it('sends the old /login (e-mail links) to the customer sign-in, keeping the query', async () => {
    const { router } = renderRoutes(routes, { path: '/login?redirect=%2Fmy-trips&reason=verified' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/customer/login?redirect=%2Fmy-trips&reason=verified');
    expect(screen.getByText('Your email address is confirmed. You can log in now.')).toBeInTheDocument();
  }, 30_000);

  it.each([
    ['/admin/login', 'admin/login'],
    ['/hotel-manager/login', 'hotel-manager/login'],
    ['/support/login', 'support/login'],
  ])('%s is the sign-in page, not a page of the guarded portal', (path, routePath) => {
    const matched = matchRoutes(routes, path)?.map((match) => match.route.path).filter(Boolean);
    expect(matched).toEqual([routePath]);
  });

  it('shows the staff portals outside the public layout (they have their own shell)', () => {
    const publicLayout = routes[0]?.children?.find((route) => route.children?.some((child) => child.index));
    // The full path of every route below the public layout (the customer area is a pathless layout route inside it).
    const below = (tree: typeof routes, parent = ''): string[] => tree.flatMap((route) => {
      const path = route.path ? `${parent}${parent ? '/' : ''}${route.path}` : parent;
      return [...(route.path ? [path] : []), ...below(route.children ?? [], path)];
    });
    const publicPaths = below(publicLayout?.children ?? []);
    expect(publicPaths).not.toContain('admin');
    expect(publicPaths).not.toContain('support');
    expect(publicPaths).not.toContain('hotel-manager');
    expect(publicPaths).toContain('customer/dashboard');
    expect(publicPaths).toContain('account');
    expect(publicPaths).toContain('my-trips');
  });
});
