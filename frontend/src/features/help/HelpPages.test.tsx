import { screen, within } from '@testing-library/react';

import type { SiteSettings } from '@/features/settings/usePublicSettings';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { ContactPage } from './ContactPage';
import { HelpPage } from './HelpPage';

const settings: { current: SiteSettings } = {
  current: { siteName: 'FlightHotel', supportEmail: 'help@flighthotel.example', supportPhone: '+91 80 4000 1234', currency: 'INR' },
};
vi.mock('@/features/settings/usePublicSettings', () => ({ usePublicSettings: () => ({ settings: settings.current }) }));

const open = (element: React.ReactElement, path: string, loggedIn: boolean) =>
  renderRoutes([{ path, element }], { path, auth: fakeAuth({ user: loggedIn ? customer : null }) });

afterEach(() => {
  settings.current = { siteName: 'FlightHotel', supportEmail: 'help@flighthotel.example', supportPhone: '+91 80 4000 1234', currency: 'INR' };
});

describe('HelpPage', () => {
  it('answers the common questions about cancellations, refunds, documents and payments', async () => {
    const { user } = open(<HelpPage />, '/help', false);

    expect(screen.getByRole('heading', { level: 1, name: 'Help & Support' })).toBeInTheDocument();
    for (const topic of ['Cancellations', 'Refunds', 'Documents', 'Payments']) {
      expect(screen.getByRole('heading', { level: 2, name: topic })).toBeInTheDocument();
      expect(within(screen.getByRole('navigation', { name: 'Topics' })).getByRole('link', { name: topic })).toBeInTheDocument();
    }
    const answer = screen.getByText(/Flights can be cancelled until 4 hours before the first departure/);
    expect(answer).not.toBeVisible();

    await user.click(screen.getByText('Until when can I cancel?'));

    expect(answer).toBeVisible();
    expect(screen.getByText(/A coupon discount is not given back/)).toBeInTheDocument();
    expect(screen.getByText(/never stored by us/)).toBeInTheDocument();
  });

  it('asks visitors to log in before creating a support ticket', () => {
    open(<HelpPage />, '/help', false);

    expect(screen.getByRole('link', { name: 'Log in to create a support ticket' }))
      .toHaveAttribute('href', '/customer/login?redirect=%2Faccount%2Fsupport%2Fnew');
    expect(screen.queryByRole('link', { name: 'My support tickets' })).not.toBeInTheDocument();
  });

  it('takes logged-in customers straight to a new ticket and their tickets', () => {
    open(<HelpPage />, '/help', true);

    expect(screen.getByRole('link', { name: 'Create a support ticket' })).toHaveAttribute('href', '/account/support/new');
    expect(screen.getByRole('link', { name: 'My support tickets' })).toHaveAttribute('href', '/account/support');
  });

  it('shows the support e-mail and phone from the public settings', () => {
    open(<HelpPage />, '/help', false);

    expect(screen.getByRole('link', { name: 'help@flighthotel.example' })).toHaveAttribute('href', 'mailto:help@flighthotel.example');
    expect(screen.getByRole('link', { name: '+91 80 4000 1234' })).toHaveAttribute('href', 'tel:+918040001234');
  });
});

describe('ContactPage', () => {
  it('offers a support ticket, the contact details and the FAQ', () => {
    open(<ContactPage />, '/contact', true);

    expect(screen.getByRole('heading', { level: 1, name: 'Contact us' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a support ticket' })).toHaveAttribute('href', '/account/support/new');
    expect(screen.getByRole('link', { name: 'help@flighthotel.example' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help & Support' })).toHaveAttribute('href', '/help');
  });

  it('leaves out contact details that are not set', () => {
    settings.current = { ...settings.current, supportEmail: null, supportPhone: null };
    open(<ContactPage />, '/contact', false);

    expect(screen.queryByRole('heading', { name: 'Contact details' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in to create a support ticket' })).toBeInTheDocument();
  });
});
