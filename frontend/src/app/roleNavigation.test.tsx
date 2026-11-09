import { screen, within } from '@testing-library/react';
import type { RouteObject } from 'react-router';

import { routes } from '@/app/router';
import { UserMenu } from '@/components/layout/UserMenu';
import { AdminLayout } from '@/features/admin/AdminLayout';
import { ADMIN_PERMISSIONS } from '@/features/admin/shared/permissions';
import type { AuthUser, Role } from '@/lib/auth/types';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';

/**
 * Role-based navigation (Phase 9 exit check): for every role, the user menu shows the right portal links, and every
 * portal route is open or answers "no access". The guards come from the real route table (app/router.tsx); the pages
 * behind them are stubs, so these tests do not depend on the portals' contents.
 */

/** Users as identity-service issues them (roles and permissions of V3__roles_and_permissions.sql). */
const users: Record<Role, AuthUser> = {
  CUSTOMER: customer,
  ADMIN: { ...customer, id: 'admin-1', email: 'admin@example.com', firstName: 'Ada', lastName: 'Admin', roles: ['ADMIN'], permissions: [...ADMIN_PERMISSIONS] },
  HOTEL_MANAGER: { ...customer, id: 'hm-1', email: 'manager@example.com', firstName: 'Hari', lastName: 'Manager', roles: ['HOTEL_MANAGER'],
    permissions: ['HOTEL_MANAGE_ASSIGNED'] },
  SUPPORT_AGENT: { ...customer, id: 'agent-1', email: 'agent@example.com', firstName: 'Sam', lastName: 'Agent', roles: ['SUPPORT_AGENT'],
    permissions: ['BOOKING_READ_ANY', 'BOOKING_MANAGE_ANY', 'PAYMENT_READ_ANY', 'SUPPORT_TICKET_MANAGE', 'USER_READ_ANY'] },
};

const ROLES = Object.keys(users) as Role[];

/** Where each role lands after sign-in (IMPLEMENTATION_PLAN.md §11.2). */
const OWN_DASHBOARD: Record<Role, string> = {
  CUSTOMER: '/customer/dashboard',
  ADMIN: '/admin',
  HOTEL_MANAGER: '/hotel-manager',
  SUPPORT_AGENT: '/support',
};
const PORTAL_LABELS = ['Admin portal', 'Hotel manager portal', 'Support portal'];

/** Portal links each role sees in the user menu (admins also open the support portal). */
const expectedLinks: Record<Role, { label: string; href: string }[]> = {
  CUSTOMER: [],
  ADMIN: [{ label: 'Admin portal', href: '/admin' }, { label: 'Support portal', href: '/support' }],
  HOTEL_MANAGER: [{ label: 'Hotel manager portal', href: '/hotel-manager' }],
  SUPPORT_AGENT: [{ label: 'Support portal', href: '/support' }],
};

/** A deep page of each portal, who may open it, and the sign-in page visitors are sent to. */
const portals: { path: string; deepLink: string; allowed: Role[]; signIn: string }[] = [
  { path: 'admin', deepLink: '/admin/users', allowed: ['ADMIN'], signIn: '/admin/login' },
  { path: 'hotel-manager', deepLink: '/hotel-manager/hotels/h1/rooms', allowed: ['HOTEL_MANAGER', 'ADMIN'], signIn: '/hotel-manager/login' },
  { path: 'support', deepLink: '/support/tickets/t1', allowed: ['SUPPORT_AGENT', 'ADMIN'], signIn: '/support/login' },
  { path: 'account', deepLink: '/account/profile', allowed: ['CUSTOMER', 'ADMIN', 'HOTEL_MANAGER', 'SUPPORT_AGENT'], signIn: '/customer/login' },
  { path: 'customer/dashboard', deepLink: '/customer/dashboard', allowed: ['CUSTOMER'], signIn: '/customer/login' },
];

const SIGN_IN_PAGES = ['/customer/login', '/admin/login', '/hotel-manager/login', '/support/login'];

/** The route of `path` that has a guard element (`/account/support` is a page, `/support` the guarded portal). */
function findRoute(tree: RouteObject[], path: string): RouteObject | undefined {
  for (const route of tree) {
    if (route.path === path && route.element) return route;
    const found = route.children && findRoute(route.children, path);
    if (found) return found;
  }
  return undefined;
}

/** The real guard of a portal with a stub page behind it (and the sign-in pages to be sent to). */
function guarded(path: string): RouteObject[] {
  const route = findRoute(routes, path);
  if (!route?.element) throw new Error(`No guarded route "${path}" in app/router.tsx`);
  return [
    ...SIGN_IN_PAGES.map((signIn) => ({ path: signIn, element: <p>sign-in page {signIn}</p> })),
    {
      path: `/${path}`,
      element: route.element,
      children: [{ index: true, element: <p>{path} portal page</p> }, { path: '*', element: <p>{path} portal page</p> }],
    },
  ];
}

describe('user menu portal links', () => {
  it.each(ROLES)('%s sees only its own portals', async (role) => {
    const user = users[role];
    const { user: actor } = renderRoutes([{ path: '/', element: <UserMenu /> }], { path: '/', auth: fakeAuth({ user }) });

    await actor.click(screen.getByRole('button', { name: `Account menu for ${user.firstName} ${user.lastName}` }));

    const menu = screen.getByRole('navigation', { name: 'Account' });
    const portalLinks = within(menu).queryAllByRole('link').filter((link) => PORTAL_LABELS.includes(link.textContent ?? ''));
    expect(portalLinks.map((link) => ({ label: link.textContent, href: link.getAttribute('href') }))).toEqual(expectedLinks[role]);
    // Everyone keeps their own account pages.
    expect(within(menu).getByRole('link', { name: 'My profile' })).toHaveAttribute('href', '/account/profile');
    if (role === 'CUSTOMER') {
      expect(within(menu).getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/account/notifications');
      expect(within(menu).getByRole('link', { name: 'Preferences' })).toHaveAttribute('href', '/account/preferences');
      expect(within(menu).getByRole('link', { name: 'Security' })).toHaveAttribute('href', '/account/security');
    } else {
      expect(within(menu).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/account/security');
    }
    // Trips and payments only for customers; system settings only for admins.
    expect(within(menu).queryByRole('link', { name: 'My Trips' }) !== null).toBe(role === 'CUSTOMER');
    expect(within(menu).queryByRole('link', { name: 'System settings' }) !== null).toBe(role === 'ADMIN');
  });
});

describe('portal routes by role', () => {
  const cases = portals.flatMap(({ path, deepLink, allowed }) =>
    ROLES.map((role) => ({ role, path, deepLink, allowed: allowed.includes(role) })));

  it.each(cases)('$deepLink for $role: allowed = $allowed', ({ role, path, deepLink, allowed }) => {
    renderRoutes(guarded(path), { path: deepLink, auth: fakeAuth({ user: users[role] }) });

    if (allowed) {
      expect(screen.getByText(`${path} portal page`)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: "You don't have access to this page" })).not.toBeInTheDocument();
    } else {
      expect(screen.getByRole('heading', { name: "You don't have access to this page" })).toBeInTheDocument();
      expect(screen.queryByText(`${path} portal page`)).not.toBeInTheDocument();
    }
  });

  it.each(portals)('sends visitors from $deepLink to $signIn, coming back afterwards', async ({ path, deepLink, signIn }) => {
    const { router } = renderRoutes(guarded(path), { path: deepLink });

    expect(await screen.findByText(`sign-in page ${signIn}`)).toBeInTheDocument();
    expect(currentLocation(router)).toBe(`${signIn}?redirect=${encodeURIComponent(deepLink)}`);
  });

  it.each(portals.filter(({ path }) => path !== 'account'))(
    "offers $signIn and the user's own dashboard when the role does not fit $deepLink",
    ({ path, deepLink, allowed, signIn }) => {
      const outsider = ROLES.find((role) => !allowed.includes(role))!;
      renderRoutes(guarded(path), { path: deepLink, auth: fakeAuth({ user: users[outsider] }) });

      const main = screen.getByRole('main');
      expect(within(main).getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute('href', OWN_DASHBOARD[outsider]);
      const signInLink = within(main).getAllByRole('link').find((link) => link.getAttribute('href')?.startsWith(`${signIn}?`));
      expect(signInLink).toHaveAttribute('href', `${signIn}?redirect=${encodeURIComponent(deepLink)}`);
    },
  );
});

describe('admin portal navigation', () => {
  const openAdmin = (user: AuthUser) => {
    const route = findRoute(routes, 'admin')!;
    return renderRoutes([{
      path: '/admin',
      element: route.element,
      children: [{ element: <AdminLayout />, children: [{ path: '*', element: <p>admin page</p> }, { index: true, element: <p>dashboard</p> }] }],
    }], { path: '/admin', auth: fakeAuth({ user }) });
  };

  it('lists every admin section for an admin, with the dashboard as the start page', () => {
    openAdmin(users.ADMIN);

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    // Reports is a submenu (closed on the dashboard).
    expect(within(nav).getByRole('button', { name: 'Reports' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).getAllByRole('link').map((link) => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Dashboard', '/admin'],
      ['Bookings', '/admin/bookings'], ['Payments', '/admin/payments'], ['Refunds', '/admin/refunds'], ['Support', '/admin/support'],
      ['Reviews', '/admin/reviews'],
      ['Hotels', '/admin/hotels'], ['Flight providers', '/admin/flight-providers'], ['Coupons', '/admin/coupons'], ['Offers', '/admin/offers'],
      ['Users', '/admin/users'], ['Audit logs', '/admin/audit-logs'], ['System settings', '/admin/settings'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('dashboard')).toBeInTheDocument();
  });

  it('opens the reports submenu: the list of reports, then each report', async () => {
    const { user } = openAdmin(users.ADMIN);

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    await user.click(within(nav).getByRole('button', { name: 'Reports' }));
    expect(within(nav).getByRole('button', { name: 'Reports' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav).getByRole('link', { name: 'All reports' })).toHaveAttribute('href', '/admin/reports');
    expect(within(nav).getByRole('link', { name: 'Revenue' })).toHaveAttribute('href', '/admin/reports/revenue');
    expect(within(nav).getByRole('link', { name: 'Hotel occupancy' })).toHaveAttribute('href', '/admin/reports/occupancy');
  });

  it('hides the sections whose permission the admin lacks', () => {
    openAdmin({ ...users.ADMIN, permissions: ['BOOKING_READ_ANY'] });

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent?.trim())).toEqual(['Bookings', 'System settings']);
  });

  it('keeps other roles out of the admin portal entirely', () => {
    openAdmin(users.SUPPORT_AGENT);

    expect(screen.getByRole('heading', { name: "You don't have access to this page" })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument();
  });
});
