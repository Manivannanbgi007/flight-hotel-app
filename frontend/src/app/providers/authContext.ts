import { createContext } from 'react';

import type { AuthResponse, AuthUser } from '@/lib/auth/types';

/** `loading` only while the session is being restored on app start. */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Stores a new session (login, password change) and tells the other tabs. */
  login: (response: AuthResponse) => void;
  /**
   * True while logout or an ended session is leaving the page: the user is still signed in for a moment, and the sign-in
   * page they are being sent to must not send them straight back to their dashboard.
   */
  signingOut?: boolean;
  /**
   * Logs out on the server (errors ignored), goes to the sign-in page of the portal the user works in (customer ->
   * /customer/login, admin -> /admin/login, hotel manager -> /hotel-manager/login, support -> /support/login), then
   * clears the session and user data in every tab.
   */
  logout: () => Promise<void>;
  /**
   * For sessions the server already ended (logout of all devices, revoked): goes to `redirectTo` (default: the user's
   * own sign-in page), then clears.
   */
  endSession: (redirectTo?: string) => Promise<void>;
  /** Keeps the header in sync after the user changes their name or photo. */
  updateUser: (patch: Partial<AuthUser>) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Navigates to `pathname` and resolves once that page has rendered. */
export type AuthNavigator = (pathname: string) => Promise<void>;

/**
 * AuthProvider sits outside the router (it must wrap RouterProvider to show the loader). The router-side
 * AuthRouterBridge hands it a navigator through this context.
 */
export const AuthNavigatorRegistry = createContext<((navigator: AuthNavigator | null) => void) | null>(null);
