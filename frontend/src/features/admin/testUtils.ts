import type { RouteObject } from 'react-router';

import type { Page } from '@/lib/api/types';
import type { AuthUser, Permission } from '@/lib/auth/types';
import { admin, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { ADMIN_PERMISSIONS } from './shared/permissions';

/** Test helpers of the admin portal pages. */

/** An admin with every permission identity-service gives the role. */
export const fullAdmin: AuthUser = { ...admin, permissions: [...ADMIN_PERMISSIONS] };

/** An admin missing some permissions (to check that the matching actions are hidden). */
export const adminWithout = (...missing: Permission[]): AuthUser => ({
  ...fullAdmin,
  permissions: ADMIN_PERMISSIONS.filter((permission) => !missing.includes(permission)),
});

export const pageOf = <T>(content: T[], overrides: Partial<Page<T>> = {}): Page<T> => ({
  content, page: 0, size: 20, totalElements: content.length, totalPages: content.length > 0 ? 1 : 0, ...overrides,
});

/** Renders admin `routes` at `path` for `user` (default: an admin with every permission). */
export function renderAdmin(routes: RouteObject[], path: string, user: AuthUser = fullAdmin) {
  return renderRoutes(routes, { path, auth: fakeAuth({ user }) });
}
