import { z } from 'zod';

import { NAME_PATTERN } from '@/features/auth/schemas';
import type { Role } from '@/lib/auth/types';
import type { Tone } from '../shared/labels';
import type { UserStatus } from './userApi';

export const USER_STATUS_INFO: Record<UserStatus, { label: string; tone: Tone }> = {
  PENDING_VERIFICATION: { label: 'Not verified yet', tone: 'warning' },
  ACTIVE: { label: 'Active', tone: 'success' },
  DEACTIVATED: { label: 'Deactivated', tone: 'danger' },
};
export const USER_STATUSES = Object.keys(USER_STATUS_INFO) as UserStatus[];

const name = (what: string) =>
  z.string().trim().min(1, `Enter the ${what}`).regex(NAME_PATTERN, 'Use letters, spaces, . \' - only');

/** Same rules as identity-service `CreateStaffUserRequest`: a valid e-mail, names, at least one role. */
export const inviteSchema = z.object({
  firstName: name('first name'),
  lastName: name('last name'),
  email: z.string().trim().min(1, 'Enter the e-mail address').max(254, 'The e-mail address is too long').email('Enter a valid e-mail address'),
  roles: z.array(z.string()).min(1, 'Choose at least one role'),
});
export type InviteForm = z.infer<typeof inviteSchema>;

export const STATUS_REASON_MAX = 255;

/** A reason is required to deactivate (it goes to the audit log); optional to activate again. */
export const statusReasonSchema = (deactivating: boolean) =>
  z.object({
    reason: deactivating
      ? z.string().trim().min(3, 'Write a short reason').max(STATUS_REASON_MAX, `Use at most ${STATUS_REASON_MAX} characters`)
      : z.string().trim().max(STATUS_REASON_MAX, `Use at most ${STATUS_REASON_MAX} characters`),
  });
export type StatusReasonForm = { reason: string };

export const asRoles = (values: string[]): Role[] => values as Role[];
