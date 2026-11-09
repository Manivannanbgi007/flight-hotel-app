import type { Role } from '@/lib/auth/types';

/** Words for codes the admin pages show. */

export const ROLE_LABELS: Record<Role, string> = {
  CUSTOMER: 'Customer',
  ADMIN: 'Admin',
  HOTEL_MANAGER: 'Hotel manager',
  SUPPORT_AGENT: 'Support agent',
};

export const ROLES = Object.keys(ROLE_LABELS) as Role[];
/** Roles an admin can give when inviting a staff member. */
export const STAFF_ROLES: Role[] = ['ADMIN', 'HOTEL_MANAGER', 'SUPPORT_AGENT'];

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? humanize(role);
}

/** `BOOKING_CANCELLED` → "Booking cancelled" (codes the page has no own words for). */
export function humanize(code: string | null | undefined): string {
  if (!code) return '';
  const words = code.replace(/[._-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
