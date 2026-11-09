import { Outlet, useLocation } from 'react-router';
import { AlertTriangle, Flag, Headset, Inbox, LayoutDashboard, Search } from 'lucide-react';

import { StaffShell } from '@/components/layout/staff/StaffShell';
import { crumbsFromNav, type StaffNavSection } from '@/components/layout/staff/staffNav';
import { GlobalSearch } from '@/features/search/GlobalSearch';
import { SEARCH_PATHS } from '@/features/search/searchModel';

const LINKS = [
  { to: '/support', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/support/tickets', label: 'Ticket queue', icon: Inbox },
  { to: '/support/escalations', label: 'Escalations', icon: Flag },
  { to: '/support/bookings', label: 'Booking lookup', icon: Search },
  { to: '/support/attention', label: 'Needs attention', icon: AlertTriangle },
];

const SECTIONS: StaffNavSection[] = [{ label: 'Support', groups: [{ title: 'Support desk', items: LINKS }] }];

const ROOT = { label: 'Support portal', to: '/support' };

/**
 * Support portal (lazy-loaded; RequireRole SUPPORT_AGENT or ADMIN) in the staff shell (violet). Actions also depend on
 * the user's permissions. The header has the global search (bookings, customers, tickets; results at /support/search).
 */
export function SupportLayout() {
  const { pathname } = useLocation();
  return (
    <StaffShell
      role="support"
      title="Support portal"
      icon={<Headset className="size-5" />}
      home="/support"
      sections={SECTIONS}
      breadcrumbs={pathname === SEARCH_PATHS.support ? [ROOT, { label: 'Search results' }] : crumbsFromNav(pathname, ROOT, SECTIONS)}
      searchSlot={<GlobalSearch placeholder="Search bookings, tickets..." />}
    >
      <Outlet />
    </StaffShell>
  );
}
