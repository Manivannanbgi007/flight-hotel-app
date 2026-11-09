import { screen, within } from '@testing-library/react';

import { RequireAuth, RequireRole } from '@/app/guards';
import type { AuthUser } from '@/lib/auth/types';
import { admin, currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';

const agent: AuthUser = { ...customer, id: 'agent-1', firstName: 'Sam', lastName: 'Agent', roles: ['SUPPORT_AGENT'] };

const routes = [
  { path: '/customer/login', element: <p>customer login page</p> },
  { path: '/admin/login', element: <p>admin login page</p> },
  { path: '/support/login', element: <p>support login page</p> },
  {
    path: '/account',
    element: <RequireAuth />,
    children: [{ path: 'profile', element: <p>profile page</p> }],
  },
  {
    path: '/admin',
    element: (
      <RequireRole roles={['ADMIN']} area="admin">
        <p>admin page</p>
      </RequireRole>
    ),
  },
  {
    path: '/support',
    element: <RequireRole roles={['SUPPORT_AGENT', 'ADMIN']} area="support" />,
    children: [{ path: '*', element: <p>support page</p> }],
  },
  {
    path: '/customer/dashboard',
    element: <RequireRole roles={['CUSTOMER']} area="customer" />,
    children: [{ index: true, element: <p>customer dashboard</p> }],
  },
];

describe('route guards', () => {
  it('waits while the session is restored instead of redirecting', () => {
    renderRoutes(routes, { path: '/account/profile', auth: fakeAuth({ status: 'loading' }) });
    expect(screen.getByRole('status')).toHaveTextContent('Restoring your session');
  });

  it('sends visitors of customer pages to the customer sign-in and remembers the page', async () => {
    const { router } = renderRoutes(routes, { path: '/account/profile?x=1' });
    expect(await screen.findByText('customer login page')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/customer/login?redirect=%2Faccount%2Fprofile%3Fx%3D1');
  });

  it('shows the page to a logged-in user', () => {
    renderRoutes(routes, { path: '/account/profile', auth: fakeAuth({ user: customer }) });
    expect(screen.getByText('profile page')).toBeInTheDocument();
  });

  it('shows "no access" for the wrong role instead of the page', () => {
    renderRoutes(routes, { path: '/admin', auth: fakeAuth({ user: customer }) });
    expect(screen.getByRole('heading', { name: "You don't have access to this page" })).toBeInTheDocument();
    expect(screen.queryByText('admin page')).not.toBeInTheDocument();
  });

  it("offers the area's sign-in (coming back here) and the user's own dashboard on the access-denied page", () => {
    renderRoutes(routes, { path: '/support/tickets?status=OPEN', auth: fakeAuth({ user: customer }) });

    const main = screen.getByRole('main');
    expect(within(main).getByText(/This area is for support agents\. You are logged in as Asha Rao/)).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute('href', '/customer/dashboard');
    expect(within(main).getByRole('link', { name: 'Sign in to the support portal' }))
      .toHaveAttribute('href', '/support/login?redirect=%2Fsupport%2Ftickets%3Fstatus%3DOPEN');
  });

  it('keeps staff out of the customer dashboard, pointing them to their own portal', () => {
    renderRoutes(routes, { path: '/customer/dashboard', auth: fakeAuth({ user: agent }) });

    expect(screen.getByRole('heading', { name: "You don't have access to this page" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute('href', '/support');
    expect(screen.getByRole('link', { name: 'Sign in as a customer' })).toHaveAttribute('href', '/customer/login?redirect=%2Fcustomer%2Fdashboard');
  });

  it('lets the right role in', () => {
    renderRoutes(routes, { path: '/admin', auth: fakeAuth({ user: admin }) });
    expect(screen.getByText('admin page')).toBeInTheDocument();
  });

  it("asks visitors to log in at the area's own sign-in page before checking roles", async () => {
    const { router } = renderRoutes(routes, { path: '/admin' });
    expect(await screen.findByText('admin login page')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/admin/login?redirect=%2Fadmin');
  });
});
