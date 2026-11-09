import { HOME_PATH } from '@/lib/paths';
import { areaOfPath, canUsePortal, portalOfArea, PORTALS, primaryPortal, signInPath } from './portals';
import type { AuthUser } from './types';

/**
 * Only same-site paths are allowed after login (`/customer/login?redirect=...`). Anything else could send the user to
 * an attacker's site right after they typed their password ("open redirect").
 */
export function safeRedirect(target: string | null | undefined): string | null {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return null;
  }
  // Control characters and backslashes are never needed in our paths, and browsers treat some of them like "/".
  if ([...target].some((char) => char.charCodeAt(0) < 0x20 || char === '\\')) {
    return null;
  }
  // Never loop back into the auth pages (the old /login and the four portal sign-in pages included).
  if (/^\/((customer|admin|hotel-manager|support)\/login|login|register|verify-email|forgot-password|reset-password)(\/|\?|#|$)/.test(target)) {
    return null;
  }
  return target;
}

/**
 * Where a user lands after login when no page asked for it: their own portal's start page (customers: their
 * dashboard; admins: the admin portal; hotel managers and support agents: theirs).
 */
export function defaultLanding(user: Pick<AuthUser, 'roles'>): string {
  return PORTALS[primaryPortal(user)].home;
}

/** May this user open `path`? Only the staff areas are limited by role here; the API checks everything again. */
export function canOpenPath(user: Pick<AuthUser, 'roles'>, path: string): boolean {
  const area = areaOfPath(path);
  return area === 'customer' ? true : canUsePortal(user, portalOfArea(area).portal);
}

/**
 * The sign-in page for a page that needs a login, remembering the page: `/admin/users` → `/admin/login?redirect=...`,
 * customer pages → `/customer/login?redirect=...`.
 */
export function loginPath(currentPath?: string): string {
  const target = safeRedirect(currentPath);
  const portal = portalOfArea(areaOfPath(target ?? '/')).portal;
  // From the home page no redirect is kept: customers land on their dashboard, as after any plain sign-in.
  const home = target === '/' || target === HOME_PATH;
  return signInPath(portal, { redirect: target && !home ? target : null });
}
