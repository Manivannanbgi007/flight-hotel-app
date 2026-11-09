import type { ComponentType } from 'react';
import {
  BarChart3, BedDouble, CalendarCheck, Headset, Hotel, Inbox, LayoutDashboard, MessagesSquare, Plane, Search, ShieldCheck, Star,
  Users, Zap, type LucideIcon,
} from 'lucide-react';

import {
  AdminSignInIllustration,
  CustomerSignInIllustration,
  ManagerSignInIllustration,
  SupportSignInIllustration,
  type IllustrationProps,
} from '@/components/illustrations';
import type { Portal } from '@/lib/auth/portals';

export interface PortalContent {
  /** Sets the role accent (role-* classes in index.css); customers use the brand. */
  roleClass: string;
  icon: LucideIcon;
  /** The page's h1. */
  heading: string;
  subtitle: (siteName: string) => string;
  /** The illustrated side. */
  storyTitle: string;
  storyText: string;
  points: { icon: LucideIcon; text: string }[];
  Illustration: ComponentType<IllustrationProps>;
}

/** What each sign-in page says and shows (features only: no figures). */
export const PORTAL_CONTENT: Record<Portal, PortalContent> = {
  CUSTOMER: {
    roleClass: '',
    icon: Plane,
    heading: 'Log in',
    subtitle: () => 'Welcome back. Log in to manage your trips.',
    storyTitle: 'Your next trip starts here',
    storyText: 'Search flights and hotels, book in minutes and follow every booking live.',
    points: [
      { icon: Plane, text: 'Flights and hotels side by side' },
      { icon: Zap, text: 'Live updates on every booking' },
      { icon: ShieldCheck, text: 'Secure payments, e-tickets and invoices' },
    ],
    Illustration: CustomerSignInIllustration,
  },
  ADMIN: {
    roleClass: 'role-admin',
    icon: ShieldCheck,
    heading: 'Log in to the admin portal',
    subtitle: (siteName) => `For the administrators of ${siteName}.`,
    storyTitle: 'Run the whole platform from one place',
    storyText: 'Bookings, payments, people and reports, for the team that keeps everything running.',
    points: [
      { icon: LayoutDashboard, text: 'Bookings, payments and refunds at a glance' },
      { icon: BarChart3, text: 'Reports and audit logs' },
      { icon: Users, text: 'Users, hotels, coupons and settings' },
    ],
    Illustration: AdminSignInIllustration,
  },
  HOTEL_MANAGER: {
    roleClass: 'role-manager',
    icon: Hotel,
    heading: 'Log in to the partner portal',
    subtitle: (siteName) => `For hotel managers who sell their rooms on ${siteName}.`,
    storyTitle: 'Your hotel, at your fingertips',
    storyText: 'Rooms, rates, availability and today’s guests, in one place made for front desks.',
    points: [
      { icon: BedDouble, text: 'Rooms, rates and the inventory calendar' },
      { icon: CalendarCheck, text: 'Arrivals, departures and reservations' },
      { icon: Star, text: 'Guest reviews and reports' },
    ],
    Illustration: ManagerSignInIllustration,
  },
  SUPPORT: {
    roleClass: 'role-support',
    icon: Headset,
    heading: 'Log in to the support portal',
    subtitle: (siteName) => `For the ${siteName} support team.`,
    storyTitle: 'Help travellers, fast',
    storyText: 'Tickets, escalations and booking look-ups in one calm workspace.',
    points: [
      { icon: Inbox, text: 'Ticket queue and escalations' },
      { icon: Search, text: 'Look up any booking' },
      { icon: MessagesSquare, text: 'Reply to travellers in one thread' },
    ],
    Illustration: SupportSignInIllustration,
  },
};
