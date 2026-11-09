import { screen, within } from '@testing-library/react';

import { customer, renderRoutes } from '@/test/renderRoutes';
import { authApi } from '../authApi';
import { AdminLoginPage, CustomerLoginPage, HotelManagerLoginPage, SupportLoginPage } from './SignInPages';

vi.mock('../authApi', () => ({
  authApi: { login: vi.fn(), logout: vi.fn(), resendVerification: vi.fn() },
}));
vi.mock('@/features/settings/usePublicSettings', () => ({
  usePublicSettings: () => ({ settings: { siteName: 'FlightHotel', supportEmail: null, supportPhone: null, currency: 'INR' } }),
}));

const routes = [
  { path: '/customer/login', element: <CustomerLoginPage /> },
  { path: '/admin/login', element: <AdminLoginPage /> },
  { path: '/hotel-manager/login', element: <HotelManagerLoginPage /> },
  { path: '/support/login', element: <SupportLoginPage /> },
  { path: '*', element: <p>landed</p> },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('development test accounts on the sign-in pages', () => {
  it.each([
    ['/customer/login', ['dev.customer1@flighthotel.local', 'dev.customer2@flighthotel.local']],
    ['/admin/login', ['dev.admin@flighthotel.local']],
    ['/hotel-manager/login', ['dev.manager1@flighthotel.local', 'dev.manager2@flighthotel.local']],
    ['/support/login', ['dev.support1@flighthotel.local']],
  ])('%s lists only its own accounts', async (path, emails) => {
    vi.stubEnv('VITE_DEV_ACCOUNTS', 'true');
    renderRoutes(routes, { path });

    const panel = await screen.findByRole('region', { name: 'Development Test Accounts' });
    const shown = within(panel).getAllByRole('listitem').map((item) => within(item).getByText(/@flighthotel\.local$/).textContent);
    expect(shown).toEqual(emails);
    // Nothing of the other roles.
    for (const other of ['admin', 'customer', 'manager', 'support']) {
      if (!emails.some((email) => email.includes(`dev.${other}`))) {
        expect(panel).not.toHaveTextContent(`dev.${other}`);
      }
    }
  });

  it('fills the form without logging in, and the normal Log in button signs in', async () => {
    vi.stubEnv('VITE_DEV_ACCOUNTS', 'true');
    vi.mocked(authApi.login).mockResolvedValue({ accessToken: 't', tokenType: 'Bearer', expiresIn: 900, user: customer });
    const { user } = renderRoutes(routes, { path: '/customer/login' });

    await user.click(await screen.findByRole('button', { name: 'Use credentials of dev.customer2@flighthotel.local' }));

    expect(screen.getByLabelText('Email')).toHaveValue('dev.customer2@flighthotel.local');
    expect(screen.getByLabelText('Password')).toHaveValue('DevTest@2026!');
    expect(authApi.login).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('landed')).toBeInTheDocument();
    expect(vi.mocked(authApi.login).mock.calls[0]?.[0]).toMatchObject({
      email: 'dev.customer2@flighthotel.local', password: 'DevTest@2026!', portal: 'CUSTOMER',
    });
  });

  it('is not there in a build made without the development flag (production)', async () => {
    vi.stubEnv('VITE_DEV_ACCOUNTS', '');
    renderRoutes(routes, { path: '/admin/login' });
    await screen.findByRole('heading', { level: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByRole('region', { name: 'Development Test Accounts' })).not.toBeInTheDocument();
    expect(screen.queryByText(/DevTest/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use credentials/i })).not.toBeInTheDocument();
  });
});
