import { Outlet, useLocation } from 'react-router';
import {
  BadgePercent, BarChart3, CreditCard, FileBarChart, Hotel, LayoutDashboard, LifeBuoy, Luggage, Megaphone, Plane, RotateCcw,
  ScrollText, Settings, ShieldCheck, Star, Users, type LucideIcon,
} from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { StaffShell } from '@/components/layout/staff/StaffShell';
import { crumbsFromNav, type StaffNavItem } from '@/components/layout/staff/staffNav';
import { GlobalSearch } from '@/features/search/GlobalSearch';
import { SEARCH_PATHS } from '@/features/search/searchModel';
import { hasPermission, type Permission } from '@/lib/auth/types';
import { useAuditExportNotifications } from './audit/useAuditExportNotifications';
import { REPORTS } from './reports/reports';

interface AdminLink {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown only with this permission (settings are open to every admin; changing them needs SETTINGS_MANAGE). */
  permission?: Permission;
  end?: boolean;
  children?: StaffNavItem[];
}

/** The admin portal's sections, grouped. */
const ADMIN_NAV: { group: string; links: AdminLink[] }[] = [
  {
    group: 'Overview',
    links: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, permission: 'REPORT_VIEW', end: true },
      {
        to: '/admin/reports',
        label: 'Reports',
        icon: BarChart3,
        permission: 'REPORT_VIEW',
        // A submenu: the list of reports, then each report.
        children: [
          { to: '/admin/reports', label: 'All reports', icon: FileBarChart, end: true },
          ...REPORTS.map((report) => ({ to: `/admin/reports/${report.key}`, label: report.title, icon: FileBarChart })),
        ],
      },
    ],
  },
  {
    group: 'Operations',
    links: [
      { to: '/admin/bookings', label: 'Bookings', icon: Luggage, permission: 'BOOKING_READ_ANY' },
      { to: '/admin/payments', label: 'Payments', icon: CreditCard, permission: 'PAYMENT_READ_ANY' },
      { to: '/admin/refunds', label: 'Refunds', icon: RotateCcw, permission: 'PAYMENT_READ_ANY' },
      { to: '/admin/support', label: 'Support', icon: LifeBuoy, permission: 'SUPPORT_TICKET_MANAGE' },
      { to: '/admin/reviews', label: 'Reviews', icon: Star, permission: 'REVIEW_MODERATE' },
    ],
  },
  {
    group: 'Catalogue',
    links: [
      { to: '/admin/hotels', label: 'Hotels', icon: Hotel, permission: 'HOTEL_MANAGE_ANY' },
      { to: '/admin/flight-providers', label: 'Flight providers', icon: Plane, permission: 'FLIGHT_PROVIDER_MANAGE' },
      { to: '/admin/coupons', label: 'Coupons', icon: BadgePercent, permission: 'COUPON_MANAGE' },
      { to: '/admin/offers', label: 'Offers', icon: Megaphone, permission: 'COUPON_MANAGE' },
    ],
  },
  {
    group: 'System',
    links: [
      { to: '/admin/users', label: 'Users', icon: Users, permission: 'USER_READ_ANY' },
      { to: '/admin/audit-logs', label: 'Audit logs', icon: ScrollText, permission: 'AUDIT_VIEW' },
      { to: '/admin/settings', label: 'System settings', icon: Settings },
    ],
  },
];

/**
 * Admin portal (lazy-loaded; RequireRole ADMIN) in the staff shell (indigo). Links follow the user's permissions; on
 * phones the sidebar is a drawer. The header has the global search (its results page is /admin/search).
 */
export function AdminLayout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  // "Your audit log export is ready" wherever the admin is in the portal.
  useAuditExportNotifications();
  const groups = ADMIN_NAV
    .map(({ group, links }) => ({
      title: group,
      items: links
        .filter((link) => !link.permission || hasPermission(user, link.permission))
        .map(({ to, label, icon, end, children }) => ({ to, label, icon, end, children })),
    }))
    .filter(({ items }) => items.length > 0);
  const sections = [{ label: 'Admin', groups }];
  const root = { label: 'Admin portal', to: '/admin' };

  return (
    <StaffShell
      role="admin"
      title="Admin portal"
      icon={<ShieldCheck className="size-5" />}
      home="/admin"
      sections={sections}
      breadcrumbs={pathname === SEARCH_PATHS.admin ? [root, { label: 'Search results' }] : crumbsFromNav(pathname, root, sections)}
      searchSlot={<GlobalSearch placeholder="Search bookings, users, pages..." />}
    >
      <Outlet />
    </StaffShell>
  );
}
