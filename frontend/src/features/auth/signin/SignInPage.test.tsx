import { screen, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import type { Portal } from '@/lib/auth/portals';
import type { AuthUser } from '@/lib/auth/types';
import { admin, currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { authApi } from '../authApi';
import { AdminLoginPage, CustomerLoginPage, HotelManagerLoginPage, SupportLoginPage } from './SignInPages';

vi.mock('../authApi', () => ({
  authApi: { login: vi.fn(), logout: vi.fn(), resendVerification: vi.fn() },
}));
vi.mock('@/features/settings/usePublicSettings', () => ({
  usePublicSettings: () => ({ settings: { siteName: 'FlightHotel', supportEmail: null, supportPhone: null, currency: 'INR' } }),
}));

const manager: AuthUser = { ...customer, id: 'm1', email: 'manager@example.com', firstName: 'Hari', lastName: 'Manager', roles: ['HOTEL_MANAGER'] };
const agent: AuthUser = { ...customer, id: 'a1', email: 'agent@example.com', firstName: 'Sam', lastName: 'Agent', roles: ['SUPPORT_AGENT'] };

const routes = [
  { path: '/customer/login', element: <CustomerLoginPage /> },
  { path: '/admin/login', element: <AdminLoginPage /> },
  { path: '/hotel-manager/login', element: <HotelManagerLoginPage /> },
  { path: '/support/login', element: <SupportLoginPage /> },
  { path: '*', element: <p>landed</p> },
];
const authResponse = (user = customer) => ({ accessToken: `token-${user.id}`, tokenType: 'Bearer' as const, expiresIn: 900, user });

async function fillAndSubmit(user: ReturnType<typeof renderRoutes>['user'], email = 'asha@example.com', password = 'Travel2026Safe') {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

beforeEach(() => {
  vi.mocked(authApi.logout).mockResolvedValue(undefined);
});

describe('customer sign-in (/customer/login)', () => {
  it('validates before calling the server', async () => {
    const { user } = renderRoutes(routes, { path: '/customer/login' });
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('sends the portal with the login and returns to the page that asked for it', async () => {
    vi.mocked(authApi.login).mockResolvedValue(authResponse());
    const auth = fakeAuth();
    const { user, router } = renderRoutes(routes, { path: '/customer/login?redirect=%2Faccount%2Fpassengers', auth });

    await user.click(screen.getByLabelText('Keep me logged in for 30 days'));
    await fillAndSubmit(user);

    expect(await screen.findByText('landed')).toBeInTheDocument();
    expect(vi.mocked(authApi.login).mock.calls[0]?.[0]).toEqual({
      email: 'asha@example.com',
      password: 'Travel2026Safe',
      rememberMe: true,
      portal: 'CUSTOMER',
    });
    expect(auth.login).toHaveBeenCalledWith(authResponse());
    expect(currentLocation(router)).toBe('/account/passengers');
  });

  it('has the split layout: one h1, the portal story, register and the other sign-in pages', () => {
    renderRoutes(routes, { path: '/customer/login?redirect=%2Fmy-trips' });

    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Your next trip starts here' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register?redirect=%2Fmy-trips');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    const others = screen.getByRole('navigation', { name: 'Other sign-in pages' });
    expect(within(others).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Sign in to the partner portal', '/hotel-manager/login'],
      ['Sign in to the admin portal', '/admin/login'],
      ['Sign in to the support portal', '/support/login'],
    ]);
    expect(others).toHaveTextContent('Hotel partner? Sign in to the partner portal');
  });

  it('shows one message for wrong email or password', async () => {
    vi.mocked(authApi.login).mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong email or password'));
    const { user } = renderRoutes(routes, { path: '/customer/login' });

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
  });

  it('offers to resend the verification email', async () => {
    vi.mocked(authApi.login).mockRejectedValue(new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Please verify'));
    vi.mocked(authApi.resendVerification).mockResolvedValue({ message: 'sent' });
    const { user } = renderRoutes(routes, { path: '/customer/login' });

    await fillAndSubmit(user, 'new@example.com');
    await user.click(await screen.findByRole('button', { name: 'Send the link again' }));

    expect(authApi.resendVerification).toHaveBeenCalledWith('new@example.com');
    expect(await screen.findByText(/We have sent a new verification link/)).toBeInTheDocument();
  });

  it('explains a locked account', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError(423, 'ACCOUNT_LOCKED', 'Locked', [], null, { lockedUntil: '2026-11-05T10:30:00Z' }),
    );
    const { user } = renderRoutes(routes, { path: '/customer/login' });

    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Account temporarily locked');
    expect(alert).toHaveTextContent(/Try again after \d{2}:\d{2}/);
  });

  it('shows why the user was sent here', () => {
    renderRoutes(routes, { path: '/customer/login?reason=session-ended' });
    expect(screen.getByRole('alert')).toHaveTextContent('You were logged out because your session was ended');
  });

  it('shows the support reference for server errors', async () => {
    vi.mocked(authApi.login).mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.', [], 'ref-123'));
    const { user } = renderRoutes(routes, { path: '/customer/login' });

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Support reference: ref-123');
  });
});

describe('after sign-in', () => {
  it.each<[Portal, string, AuthUser, string]>([
    ['CUSTOMER', '/customer/login', customer, '/customer/dashboard'],
    ['ADMIN', '/admin/login', admin, '/admin'],
    ['HOTEL_MANAGER', '/hotel-manager/login', manager, '/hotel-manager'],
    ['SUPPORT', '/support/login', agent, '/support'],
    // Admins may use the partner and support sign-ins; they land in that portal.
    ['HOTEL_MANAGER', '/hotel-manager/login', admin, '/hotel-manager'],
    ['SUPPORT', '/support/login', admin, '/support'],
  ])('%s sign-in sends the portal and lands %s accounts on their start page', async (portal, path, account, landing) => {
    vi.mocked(authApi.login).mockResolvedValue(authResponse(account));
    const { user, router } = renderRoutes(routes, { path });

    await fillAndSubmit(user, account.email);

    expect(await screen.findByText('landed')).toBeInTheDocument();
    expect(vi.mocked(authApi.login).mock.calls[0]?.[0]).toMatchObject({ portal });
    expect(currentLocation(router)).toBe(landing);
  });

  it('ignores a redirect to another site and uses the portal start page', async () => {
    vi.mocked(authApi.login).mockResolvedValue(authResponse(admin));
    const { user, router } = renderRoutes(routes, { path: '/admin/login?redirect=https%3A%2F%2Fevil.example.com' });

    await fillAndSubmit(user);

    expect(await screen.findByText('landed')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/admin');
  });

  it('ignores a redirect into an area the account cannot open', async () => {
    vi.mocked(authApi.login).mockResolvedValue(authResponse(customer));
    const { user, router } = renderRoutes(routes, { path: '/customer/login?redirect=%2Fadmin%2Fusers' });

    await fillAndSubmit(user);

    expect(await screen.findByText('landed')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/customer/dashboard');
  });

  it('goes straight on when already logged in with an account that belongs here', async () => {
    const { router } = renderRoutes(routes, { path: '/support/login?redirect=%2Fsupport%2Ftickets', auth: fakeAuth({ user: agent }) });

    expect(await screen.findByText('landed')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/support/tickets');
  });

  it('says who is logged in when that account does not belong here', () => {
    renderRoutes(routes, { path: '/admin/login', auth: fakeAuth({ user: customer }) });

    expect(screen.getByRole('status')).toHaveTextContent('You are logged in as Asha Rao. Logging in here with another account switches to that account.');
    expect(screen.getByRole('heading', { level: 1, name: 'Log in to the admin portal' })).toBeInTheDocument();
  });
});

describe('wrong portal', () => {
  it('explains a 403 PORTAL_NOT_ALLOWED from the server and links the other sign-in pages', async () => {
    vi.mocked(authApi.login).mockRejectedValue(new ApiError(403, 'PORTAL_NOT_ALLOWED', 'This account cannot sign in here.'));
    const auth = fakeAuth();
    const { user } = renderRoutes(routes, { path: '/admin/login', auth });

    await fillAndSubmit(user, 'asha@example.com');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("This account can't sign in here");
    expect(alert).toHaveTextContent('This sign-in page is for administrators.');
    expect(within(alert).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/customer/login', '/hotel-manager/login', '/support/login',
    ]);
    expect(auth.login).not.toHaveBeenCalled();
    expect(authApi.logout).not.toHaveBeenCalled();
  });

  it('links the page named in the server refusal (details.portals)', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError(403, 'PORTAL_NOT_ALLOWED', 'This account cannot sign in here.', [], null, { portals: ['CUSTOMER'] }),
    );
    const auth = fakeAuth();
    const { user } = renderRoutes(routes, { path: '/admin/login', auth });

    await fillAndSubmit(user, 'asha@example.com');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/customer/login']);
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('skips the current page in details.portals (an admin on the customer sign-in goes to the admin portal)', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError(403, 'PORTAL_NOT_ALLOWED', 'This account cannot sign in here.', [], null, {
        portals: ['ADMIN', 'HOTEL_MANAGER', 'SUPPORT'],
      }),
    );
    const { user } = renderRoutes(routes, { path: '/customer/login', auth: fakeAuth() });

    await fillAndSubmit(user, 'admin@example.com');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/admin/login']);
  });

  it('checks the role itself after login: ends the session again and points to the right page', async () => {
    vi.mocked(authApi.login).mockResolvedValue(authResponse(admin));
    const auth = fakeAuth();
    const { user, router } = renderRoutes(routes, { path: '/customer/login', auth });

    await fillAndSubmit(user, 'admin@example.com');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("This account can't sign in here");
    expect(alert).toHaveTextContent('This sign-in page is for travellers with a customer account.');
    expect(within(alert).getByRole('link', { name: 'Sign in to the admin portal' })).toHaveAttribute('href', '/admin/login');
    expect(authApi.logout).toHaveBeenCalledWith('token-admin-1');
    expect(auth.login).not.toHaveBeenCalled();
    expect(currentLocation(router)).toBe('/customer/login');
  });

  it('refuses a customer on the partner sign-in the same way', async () => {
    vi.mocked(authApi.login).mockResolvedValue(authResponse(customer));
    const auth = fakeAuth();
    const { user } = renderRoutes(routes, { path: '/hotel-manager/login', auth });

    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: 'Sign in as a customer' })).toHaveAttribute('href', '/customer/login');
    expect(auth.login).not.toHaveBeenCalled();
  });
});
