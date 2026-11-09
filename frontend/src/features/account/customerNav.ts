import {
  Bell, CreditCard, Inbox, LayoutDashboard, LifeBuoy, Luggage, PenSquare, Settings2, Shield, SlidersHorizontal, Star, Ticket,
  User, Users,
} from 'lucide-react';

import type { NavSection } from '@/components/layout/nav/navModel';
import type { AuthUser } from '@/lib/auth/types';

/** The customer's own pages, grouped (the dashboard only for customers; staff also have an account here). */
export function customerNav(user: AuthUser): NavSection[] {
  const isCustomer = user.roles.includes('CUSTOMER');
  return [
    {
      label: 'My account',
      groups: [
        {
          title: 'Overview',
          items: [
            ...(isCustomer ? [{ to: '/customer/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true }] : []),
            { to: '/my-trips', label: 'My trips', icon: Luggage },
          ],
        },
        {
          title: 'Activity',
          items: [
            { to: '/account/payments', label: 'Payment history', icon: CreditCard },
            {
              to: '/account/notifications',
              label: 'Notifications',
              icon: Bell,
              children: [
                { to: '/account/notifications', label: 'Inbox', icon: Inbox, end: true },
                { to: '/account/notifications/settings', label: 'Notification settings', icon: Settings2 },
              ],
            },
            { to: '/account/reviews', label: 'My reviews', icon: Star },
            {
              to: '/account/support',
              label: 'Support tickets',
              icon: LifeBuoy,
              children: [
                { to: '/account/support', label: 'My tickets', icon: Ticket, end: true },
                { to: '/account/support/new', label: 'New ticket', icon: PenSquare },
              ],
            },
          ],
        },
        {
          title: 'Account',
          items: [
            { to: '/account/profile', label: 'Profile', icon: User },
            { to: '/account/passengers', label: 'Saved passengers', icon: Users },
            { to: '/account/preferences', label: 'Travel preferences', icon: SlidersHorizontal },
            { to: '/account/security', label: 'Security', icon: Shield },
          ],
        },
      ],
    },
  ];
}
