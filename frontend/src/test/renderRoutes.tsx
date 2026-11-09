import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { Toaster } from 'sonner';
import { vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/app/providers/authContext';
import type { AuthUser } from '@/lib/auth/types';

export const customer: AuthUser = {
  id: '0192f0c4-8a7e-7c3a-9f1e-3b7f1c2d4e5a',
  email: 'asha@example.com',
  firstName: 'Asha',
  lastName: 'Rao',
  roles: ['CUSTOMER'],
  permissions: [],
  emailVerified: true,
  hasPhoto: false,
};

export const admin: AuthUser = { ...customer, id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] };

/** An AuthContext value with spies; `user` decides the status unless `status` is given. */
export function fakeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const user = overrides.user ?? null;
  return {
    status: user ? 'authenticated' : 'anonymous',
    user,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(undefined),
    updateUser: vi.fn(),
    ...overrides,
  };
}

/**
 * Renders `routes` in a memory router at `path`, with a fresh query client (no retries) and a fake auth context.
 * Returns the router so tests can check where the app navigated.
 */
export function renderRoutes(
  routes: RouteObject[] | ReactElement,
  { path = '/', auth = fakeAuth() }: { path?: string; auth?: AuthContextValue } = {},
) {
  const routeObjects: RouteObject[] = Array.isArray(routes) ? routes : [{ path: '*', element: routes }];
  const router = createMemoryRouter(
    [...routeObjects, { path: '/__other/*', element: <p>other page</p> }],
    { initialEntries: [path] },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
      <Toaster />
    </QueryClientProvider>,
  );
  return { ...view, router, queryClient, user, auth };
}

/** Where the memory router is now, e.g. "/login?redirect=%2Faccount". */
export function currentLocation(router: ReturnType<typeof createMemoryRouter>): string {
  return router.state.location.pathname + router.state.location.search;
}
