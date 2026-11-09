import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';

import { AuthRouterBridge } from '@/app/AuthRouterBridge';
import { authApi } from '@/features/auth/authApi';
import { refreshAccessToken } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryKeys';
import { sessionStore } from '@/lib/auth/sessionStore';
import { realtimeBus } from '@/lib/realtime/eventBus';
import { customer } from '@/test/renderRoutes';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';

vi.mock('@/lib/api/client', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/features/auth/authApi', () => ({ authApi: { logout: vi.fn() } }));

function Status() {
  const { status, user, logout } = useAuth();
  return (
    <div>
      <p>status: {status}</p>
      <p>user: {user?.email ?? 'none'}</p>
      <button type="button" onClick={() => void logout()}>
        log out
      </button>
    </div>
  );
}

function renderApp(path = '/account') {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <AuthRouterBridge />
            <Outlet />
          </>
        ),
        children: [{ path: '*', element: <Status /> }],
      },
    ],
    { initialEntries: [path] },
  );
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

/** The refresh call restores the session from the cookie (here: the fake session). */
function restoresSession() {
  vi.mocked(refreshAccessToken).mockImplementation(async () => {
    sessionStore.set({ accessToken: 'token', user: customer });
    return true;
  });
}

afterEach(() => {
  sessionStore.clear();
});

describe('AuthProvider', () => {
  it('restores the session after a page reload', async () => {
    let finishRefresh: (restored: boolean) => void = () => {};
    vi.mocked(refreshAccessToken).mockImplementation(
      () => new Promise<boolean>((resolve) => {
        finishRefresh = (restored) => {
          sessionStore.set({ accessToken: 'token', user: customer });
          resolve(restored);
        };
      }),
    );
    renderApp();

    // Until the refresh cookie was checked, guards must wait instead of treating the user as a visitor.
    expect(screen.getByText('status: loading')).toBeInTheDocument();
    act(() => finishRefresh(true));
    expect(await screen.findByText('status: authenticated')).toBeInTheDocument();
    expect(screen.getByText('user: asha@example.com')).toBeInTheDocument();
  });

  it('is anonymous when there is no session to restore', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue(false);
    renderApp();
    expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
  });

  it('logs out: leaves the page first, then clears the session and the user data', async () => {
    restoresSession();
    vi.mocked(authApi.logout).mockResolvedValue(undefined);
    const { router, queryClient } = renderApp('/account/profile');
    await screen.findByText('status: authenticated');
    queryClient.setQueryData(queryKeys.account.profile, { firstName: 'Asha' });
    queryClient.setQueryData(queryKeys.publicSettings, { siteName: 'FlightHotel' });

    await act(async () => screen.getByRole('button', { name: 'log out' }).click());

    expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
    expect(authApi.logout).toHaveBeenCalledTimes(1);
    // A customer lands on the customer sign-in page, clean (no ?redirect=), and stays there.
    expect(router.state.location.pathname + router.state.location.search).toBe('/customer/login');
    expect(queryClient.getQueryData(queryKeys.account.profile)).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.publicSettings)).toEqual({ siteName: 'FlightHotel' });
  });

  it.each([
    [['ADMIN'], '/admin/login'],
    [['HOTEL_MANAGER'], '/hotel-manager/login'],
    [['SUPPORT_AGENT'], '/support/login'],
    [['CUSTOMER'], '/customer/login'],
  ] as const)('sends %s to their own sign-in page on logout, and nothing protected is left behind', async (roles, signIn) => {
    vi.mocked(refreshAccessToken).mockImplementation(async () => {
      sessionStore.set({ accessToken: 'token', user: { ...customer, roles: [...roles] } });
      return true;
    });
    vi.mocked(authApi.logout).mockResolvedValue(undefined);
    const { router } = renderApp('/account/profile');
    await screen.findByText('status: authenticated');

    await act(async () => screen.getByRole('button', { name: 'log out' }).click());

    expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
    expect(router.state.location.pathname + router.state.location.search).toBe(signIn);
    // The page that was open was replaced in the history: back does not return to it, and no token is kept.
    expect(router.state.historyAction).toBe('REPLACE');
    expect(sessionStore.get()).toBeNull();
  });

  it('still logs out locally when the server call fails', async () => {
    restoresSession();
    vi.mocked(authApi.logout).mockRejectedValue(new Error('offline'));
    renderApp();
    await screen.findByText('status: authenticated');

    await act(async () => screen.getByRole('button', { name: 'log out' }).click());

    expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
  });

  it.each([
    ['LOGOUT_ALL', '?reason=logged-out-everywhere'],
    ['DEACTIVATED', '?reason=account-deactivated'],
    ['PASSWORD_RESET', '?reason=session-ended'],
  ])('ends the session when the server revokes it (%s)', async (reason, search) => {
    restoresSession();
    const { router } = renderApp('/account/security');
    await screen.findByText('status: authenticated');

    act(() => {
      realtimeBus.publish({
        id: 'm1',
        type: 'session.revoked',
        resourceType: 'USER',
        resourceId: customer.id,
        data: { reason },
        occurredAt: new Date().toISOString(),
      });
    });

    expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
    // A customer goes to the customer sign-in page (staff to their own portal's).
    expect(router.state.location.pathname + router.state.location.search).toBe(`/customer/login${search}`);
  });
});
