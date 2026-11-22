/** Words for codes the admin pages show. */

export const ROLE_LABELS = {
  CUSTOMER: 'Customer',
  ADMIN: 'Admin',
  HOTEL_MANAGER: 'Hotel manager',
  SUPPORT_AGENT: 'Support agent',
};

export const ROLES = Object.keys(ROLE_LABELS);
/** Roles an admin can give when inviting a staff member. */
export const STAFF_ROLES = ['ADMIN', 'HOTEL_MANAGER', 'SUPPORT_AGENT'];

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? humanize(role);
}

/** `BOOKING_CANCELLED` → "Booking cancelled" (codes the page has no own words for). */
export function humanize(code) {
  if (!code) return '';
  const words = code
    .replace(/[._-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
