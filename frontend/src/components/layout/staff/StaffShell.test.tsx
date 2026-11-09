import { screen, within } from '@testing-library/react';
import { Inbox, LayoutDashboard, Search } from 'lucide-react';

import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { StaffShell } from './StaffShell';
import { crumbsFromNav, type StaffNavSection } from './staffNav';

vi.mock('@/features/settings/usePublicSettings', () => ({
  usePublicSettings: () => ({ settings: { siteName: 'FlightHotel', supportEmail: null, supportPhone: null, currency: 'INR' } }),
}));
vi.mock('@/features/notifications/notificationApi', () => ({
  notificationApi: { unreadCount: vi.fn().mockResolvedValue(0), list: vi.fn() },
}));

const sections: StaffNavSection[] = [{
  label: 'Support',
  groups: [{
    title: 'Support desk',
    items: [
      { to: '/support', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/support/tickets', label: 'Ticket queue', icon: Inbox },
      { to: '/support/bookings', label: 'Booking lookup', icon: Search },
    ],
  }],
}];

const agent = { ...customer, firstName: 'Sam', lastName: 'Agent', roles: ['SUPPORT_AGENT' as const] };

const open = (path = '/support/tickets') => renderRoutes([{
  path: '/support/*',
  element: (
    <StaffShell role="support" title="Support portal" icon={<Inbox />} home="/support" sections={sections}
      breadcrumbs={crumbsFromNav(path, { label: 'Support portal', to: '/support' }, sections)}>
      <h1>page title</h1>
    </StaffShell>
  ),
}], { path, auth: fakeAuth({ user: agent }) });

afterEach(() => {
  window.localStorage.clear();
});

describe('StaffShell', () => {
  it('has the role accent, a skip link, the sidebar navigation, breadcrumbs, the account menu and the page in <main>', () => {
    const { container } = open();

    expect(container.querySelector('.role-support')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    const nav = screen.getByRole('navigation', { name: 'Support' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Dashboard', 'Ticket queue', 'Booking lookup']);
    expect(within(nav).getByRole('link', { name: 'Ticket queue' })).toHaveAttribute('aria-current', 'page');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Support portal' })).toHaveAttribute('href', '/support');
    expect(within(crumbs).getByText('Ticket queue')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Account menu for Sam Agent' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'page title' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View website' })).toHaveAttribute('href', '/customer/home');
    // Expanded: no tooltips.
    expect(document.querySelector('[data-nav-tooltip]')).toBeNull();
  });

  it('puts the portal search in the header, between the breadcrumbs and the account menu', () => {
    renderRoutes([{
      path: '/support/*',
      element: (
        <StaffShell role="support" title="Support portal" icon={<Inbox />} home="/support" sections={sections}
          breadcrumbs={[{ label: 'Support portal' }]}
          searchSlot={<form role="search" aria-label="Global search"><input aria-label="Search" /></form>}>
          <h1>page title</h1>
        </StaffShell>
      ),
    }], { path: '/support', auth: fakeAuth({ user: agent }) });

    const header = screen.getByRole('banner');
    const search = within(header).getByRole('search', { name: 'Global search' });
    const crumbs = within(header).getByRole('navigation', { name: 'Breadcrumb' });
    const account = within(header).getByRole('button', { name: 'Account menu for Sam Agent' });
    expect(crumbs.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(search.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('collapses the sidebar to icons (names stay for screen readers) and remembers it', async () => {
    const { user } = open();

    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
    const link = within(screen.getByRole('navigation', { name: 'Support' })).getByRole('link', { name: 'Ticket queue' });
    // The name moves to a tooltip shown on hover and focus.
    expect(document.querySelector('[data-nav-tooltip]')).toBeNull();
    await user.hover(link);
    expect(document.querySelector('[data-nav-tooltip]')).toHaveTextContent('Ticket queue');
    await user.unhover(link);
    expect(document.querySelector('[data-nav-tooltip]')).toBeNull();
    expect(window.localStorage.getItem('fh.staff.sidebarCollapsed')).toBe('1');
  });

  it('opens the navigation as a drawer on phones: focus inside, Escape closes and gives focus back', async () => {
    const { user } = open();

    const opener = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(opener);
    const drawer = screen.getByRole('dialog', { name: 'Support portal navigation' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(within(drawer).getByRole('button', { name: 'Close navigation' })).toHaveFocus();
    expect(within(drawer).getByRole('navigation', { name: 'Support' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes the drawer after choosing a page', async () => {
    const { user } = open();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = screen.getByRole('dialog', { name: 'Support portal navigation' });
    await user.click(within(drawer).getByRole('link', { name: 'Booking lookup' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('crumbsFromNav', () => {
  it('names the section and adds "Details" below it', () => {
    const root = { label: 'Support portal', to: '/support' };
    expect(crumbsFromNav('/support', root, sections)).toEqual([{ label: 'Support portal', to: '/support' }, { label: 'Dashboard' }]);
    expect(crumbsFromNav('/support/tickets/t1', root, sections)).toEqual([
      { label: 'Support portal', to: '/support' }, { label: 'Ticket queue', to: '/support/tickets' }, { label: 'Details' },
    ]);
  });
});
