import { screen, waitFor, within } from '@testing-library/react';

import type { SiteSettings } from '@/features/settings/usePublicSettings';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { PublicLayout } from './PublicLayout';
import { UserMenu } from './UserMenu';

const settings: { current: SiteSettings } = {
  current: { siteName: 'FlightHotel', supportEmail: 'help@flighthotel.example', supportPhone: '+91 80 4000 1234', currency: 'INR' },
};
vi.mock('@/features/settings/usePublicSettings', () => ({ usePublicSettings: () => ({ settings: settings.current }) }));
vi.mock('@/features/notifications/notificationApi', () => ({
  notificationApi: { unreadCount: vi.fn().mockResolvedValue(0), list: vi.fn() },
}));
vi.mock('@/features/search/searchApi', () => ({
  searchApi: { suggest: vi.fn().mockResolvedValue({ query: '', tookMs: 1, groups: [] }), search: vi.fn() },
}));

afterEach(() => {
  settings.current = { siteName: 'FlightHotel', supportEmail: 'help@flighthotel.example', supportPhone: '+91 80 4000 1234', currency: 'INR' };
});

const openLayout = (path: string, auth = fakeAuth()) => renderRoutes([{
  path: '/',
  element: <PublicLayout />,
  children: [
    { index: true, element: <p>home page</p> },
    { path: 'hotels', element: <p>hotels page</p> },
    { path: '*', element: <p>some page</p> },
  ],
}], { path, auth });

describe('PublicLayout', () => {
  it('has the brand, the main navigation with the current page marked, and a skip link', () => {
    openLayout('/hotels');

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getByRole('link', { name: 'FlightHotel' })).toHaveAttribute('href', '/customer/home');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Flights', 'Hotels', 'My Trips', 'Offers', 'Help & Support']);
    expect(within(nav).getByRole('link', { name: 'Hotels' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Flights' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('hotels page')).toBeInTheDocument();
  });

  it('shows the support contacts, footer links and newsletter sign-up from the site settings', () => {
    openLayout('/');

    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'help@flighthotel.example' })).toHaveAttribute('href', 'mailto:help@flighthotel.example');
    expect(within(footer).getByText('+91 80 4000 1234')).toBeInTheDocument();
    const links = within(footer).getByRole('navigation', { name: 'Footer' });
    expect(within(links).getByRole('link', { name: 'About us' })).toHaveAttribute('href', '/about');
    expect(within(links).getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact');
    expect(within(footer).getByRole('form', { name: 'Newsletter' })).toBeInTheDocument();
    expect(within(footer).getByText(`© ${new Date().getFullYear()} FlightHotel`)).toBeInTheDocument();
  });

  it('leaves out support contacts that are not configured and uses the configured site name', () => {
    settings.current = { siteName: 'TripNest', supportEmail: null, supportPhone: null, currency: 'INR' };
    openLayout('/');

    expect(screen.getByRole('link', { name: 'TripNest' })).toBeInTheDocument();
    expect(within(screen.getByRole('contentinfo')).queryByRole('link', { name: /@/ })).not.toBeInTheDocument();
  });

  it('opens the mobile menu, which offers login to visitors and closes after choosing a page', async () => {
    const { user, router } = openLayout('/');

    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Main mobile' })).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAccessibleName('Close menu');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const mobile = screen.getByRole('navigation', { name: 'Main mobile' });
    expect(within(mobile).getByRole('link', { name: 'Login / Register' })).toHaveAttribute('href', '/customer/login');

    await user.click(within(mobile).getByRole('link', { name: 'Offers' }));

    expect(currentLocation(router)).toBe('/offers');
    expect(screen.queryByRole('navigation', { name: 'Main mobile' })).not.toBeInTheDocument();
  });

  it.each([
    ['a visitor', fakeAuth()],
    ['a customer', fakeAuth({ user: customer })],
  ])('offers %s the global search in the header and at the top of the mobile menu', async (_who, auth) => {
    const { user, router } = openLayout('/', auth);
    const label = 'Search hotels, flights, bookings and more';

    const header = screen.getByRole('banner');
    const search = within(header).getByRole('search', { name: 'Global search' });
    expect(within(search).getByRole('combobox', { name: label })).toHaveAttribute('placeholder', 'Search hotels, flights, bookings and more...');
    expect(screen.queryByRole('searchbox', { name: 'Search my trips' })).not.toBeInTheDocument();
    await user.keyboard('/');
    expect(within(search).getByRole('combobox', { name: label })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const mobile = screen.getByRole('navigation', { name: 'Main mobile' });
    // The menu's copy is first in the menu and does not answer "/" (the header's does).
    expect(within(mobile).getAllByRole('combobox')).toHaveLength(1);
    await user.type(within(mobile).getByRole('combobox', { name: label }), 'goa{Enter}');

    expect(currentLocation(router)).toBe('/search?q=goa');
    expect(screen.queryByRole('navigation', { name: 'Main mobile' })).not.toBeInTheDocument();
  });

  it('shows the account menu and the notification bell instead of login when logged in', async () => {
    const { user } = openLayout('/', fakeAuth({ user: customer }));

    expect(screen.queryByRole('link', { name: 'Login / Register' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu for Asha Rao' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Notifications/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(within(screen.getByRole('navigation', { name: 'Main mobile' })).queryByRole('link', { name: 'Login / Register' }))
      .not.toBeInTheDocument();
  });
});

describe('UserMenu', () => {
  const openMenu = (auth = fakeAuth({ user: customer })) => renderRoutes([
    { path: '/', element: <><UserMenu /><p>page content</p></> },
    { path: '*', element: <p>other page</p> },
  ], { path: '/', auth });

  it('shows nothing to click while the session is being restored', () => {
    openMenu(fakeAuth({ status: 'loading' }));

    expect(screen.queryByRole('link', { name: 'Login / Register' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the user and closes with Escape or a click outside', async () => {
    const { user } = openMenu();
    const button = screen.getByRole('button', { name: 'Account menu for Asha Rao' });
    expect(screen.getByText('AR')).toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('asha@example.com')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Account' })).not.toBeInTheDocument();

    await user.click(button);
    // A click inside the menu keeps it open.
    await user.click(screen.getByText('asha@example.com'));
    expect(screen.getByRole('navigation', { name: 'Account' })).toBeInTheDocument();
    await user.click(screen.getByText('page content'));
    expect(screen.queryByRole('navigation', { name: 'Account' })).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes after choosing a page', async () => {
    const { user, router } = openMenu();

    await user.click(screen.getByRole('button', { name: 'Account menu for Asha Rao' }));
    await user.click(screen.getByRole('link', { name: 'Payment history' }));

    expect(currentLocation(router)).toBe('/account/payments');
    expect(screen.queryByRole('navigation', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('logs out', async () => {
    const auth = fakeAuth({ user: customer });
    const { user } = openMenu(auth);

    await user.click(screen.getByRole('button', { name: 'Account menu for Asha Rao' }));
    await user.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Account menu for Asha Rao' })).toBeEnabled());
  });
});
