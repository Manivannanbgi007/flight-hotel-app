import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from '@/app/providers/useAuth';
import { FullPageLoader } from '@/components/ui/FullPageLoader';
import { type Area, portalOfArea, signInPath } from '@/lib/auth/portals';
import { loginPath, safeRedirect } from '@/lib/auth/redirects';
import { hasAnyRole, type Role } from '@/lib/auth/types';
import { ForbiddenPage } from '@/pages/ForbiddenPage';

/**
 * Pages below need a logged-in user. Visitors go to the sign-in page of the page's area (`/admin/...` →
 * `/admin/login`, customer pages → `/customer/login`) with `?redirect=` back to the page. While the session is being
 * restored (page reload) a loader is shown, so the user is not bounced to the sign-in page for a split second.
 * <p>
 * This is for user experience only: every API checks the token and the roles again.
 */
export function RequireAuth({ area, children }: { area?: Area; children?: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageLoader label="Restoring your session…" />;
  }
  if (status === 'anonymous') {
    const here = location.pathname + location.search;
    const target = area
      ? signInPath(portalOfArea(area).portal, { redirect: safeRedirect(here) })
      : loginPath(here);
    return <Navigate to={target} replace />;
  }
  return children ?? <Outlet />;
}

/**
 * Pages below need one of `roles` (and a login). Other users see the access-denied page (with links to the area's
 * sign-in and to their own dashboard) instead of a redirect loop.
 */
export function RequireRole({ roles, area, children }: { roles: readonly Role[]; area?: Area; children?: ReactNode }) {
  const { user } = useAuth();
  return (
    <RequireAuth area={area}>
      {hasAnyRole(user, roles) ? (children ?? <Outlet />) : <ForbiddenPage area={area} />}
    </RequireAuth>
  );
}
