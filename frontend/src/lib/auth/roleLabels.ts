import type { Role } from './types';

const LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  HOTEL_MANAGER: 'Hotel manager',
  SUPPORT_AGENT: 'Support agent',
  CUSTOMER: 'Customer',
};

/** The most senior role first: an admin who can also manage hotels is shown as an administrator. */
const ORDER: Role[] = ['ADMIN', 'HOTEL_MANAGER', 'SUPPORT_AGENT', 'CUSTOMER'];

/** "Administrator", "Hotel manager", "Support agent" or "Customer": how the header names the signed-in user's role. */
export function primaryRoleLabel(roles: readonly Role[]): string {
  const role = ORDER.find((candidate) => roles.includes(candidate));
  return role ? LABELS[role] : 'Account';
}

export const roleLabel = (role: Role): string => LABELS[role];
