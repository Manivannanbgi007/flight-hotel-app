import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

import { authApi } from '@/features/auth/authApi';
import { refreshAccessToken } from '@/lib/api/client';
import { PUBLIC_QUERY_ROOTS } from '@/lib/api/queryKeys';
import { primaryPortal, signInPath } from '@/lib/auth/portals';
import { sessionStore } from '@/lib/auth/sessionStore';
import { toSession, type AuthResponse, type AuthUser } from '@/lib/auth/types';
import { realtimeBus } from '@/lib/realtime/eventBus';
import { AuthContext, AuthNavigatorRegistry, type AuthContextValue, type AuthNavigator, type AuthStatus } from './authContext';

/** The sign-in page of the portal the user works in (staff -> their portal, customers -> /customer/login). */
function ownSignInPath(): string {
  const user = sessionStore.get()?.user;
  return signInPath(user ? primaryPortal(user) : 'CUSTOMER');
}

/**
 * Owns the login state of the app:
 * - restores the session on start through the HttpOnly refresh cookie (the access token is only kept in memory),
 * - follows logins/logouts in other tabs (sessionStore.syncTabs),
 * - ends the session when the server says so (realtime `session.revoked`: deactivated, password reset, logout-all),
 * - removes the previous user's cached data whenever the user changes or logs out.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get);
  const [restoring, setRestoring] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const navigatorRef = useRef<AuthNavigator | null>(null);

  useEffect(() => {
    let active = true;
    void refreshAccessToken().finally(() => {
      if (active) {
        setRestoring(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => sessionStore.syncTabs({ onRemoteLogin: () => void refreshAccessToken() }), []);

  useEffect(() => {
    let previousUserId = sessionStore.get()?.user.id ?? null;
    return sessionStore.subscribe((next) => {
      const userId = next?.user.id ?? null;
      if (previousUserId && userId !== previousUserId) {
        clearUserData(queryClient);
      }
      previousUserId = userId;
    });
  }, [queryClient]);

  const goTo = useCallback(async (pathname: string) => {
    const navigate = navigatorRef.current;
    if (navigate) {
      await navigate(pathname);
    }
  }, []);

  const login = useCallback((response: AuthResponse) => sessionStore.signIn(toSession(response)), []);

  /**
   * Leaves the protected page for `pathname` (the history entry is replaced), runs `serverSide` (the server's logout),
   * then clears the session everywhere. The page is left FIRST: once the server has ended the session, a request still
   * running on the old page would get 401 and clear the session while that page is open, and the page's guard would then
   * send the user to the sign-in page with `?redirect=` to the page they just left.
   */
  const leaveAndSignOut = useCallback(
    async (pathname: string, serverSide?: () => Promise<void>) => {
      setSigningOut(true);
      try {
        await goTo(pathname);
        await serverSide?.();
        sessionStore.signOut();
      } finally {
        setSigningOut(false);
      }
    },
    [goTo],
  );

  const logout = useCallback(async () => {
    await leaveAndSignOut(ownSignInPath(), async () => {
      try {
        await authApi.logout();
      } catch {
        // Already ended on the server, or offline: the local logout below still happens.
      }
    });
  }, [leaveAndSignOut]);

  const endSession = useCallback(
    async (redirectTo?: string) => {
      await leaveAndSignOut(redirectTo ?? ownSignInPath());
    },
    [leaveAndSignOut],
  );

  const updateUser = useCallback((patch: Partial<AuthUser>) => sessionStore.updateUser(patch), []);

  // The server ended every session of this user (account deactivated, password reset, "log out everywhere").
  const endSessionRef = useRef(endSession);
  useEffect(() => {
    endSessionRef.current = endSession;
  });
  useEffect(
    () =>
      realtimeBus.subscribe('session.revoked', (message) => {
        const user = sessionStore.get()?.user;
        if (user) {
          void endSessionRef.current(signInPath(primaryPortal(user), { reason: revokedReason(message.data.reason) }));
        }
      }),
    [],
  );

  const status: AuthStatus = session ? 'authenticated' : restoring ? 'loading' : 'anonymous';
  const value = useMemo<AuthContextValue>(
    () => ({ status, user: session?.user ?? null, signingOut, login, logout, endSession, updateUser }),
    [status, session, signingOut, login, logout, endSession, updateUser],
  );

  const registerNavigator = useCallback((navigator: AuthNavigator | null) => {
    navigatorRef.current = navigator;
  }, []);

  return (
    <AuthNavigatorRegistry.Provider value={registerNavigator}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </AuthNavigatorRegistry.Provider>
  );
}

/** `session.revoked` reason (identity-service RevokeReason) → the login page message to show. */
function revokedReason(reason: unknown): string {
  if (reason === 'LOGOUT_ALL') return 'logged-out-everywhere';
  if (reason === 'DEACTIVATED') return 'account-deactivated';
  return 'session-ended';
}

/** Removes everything except public data (site settings) from the cache. */
function clearUserData(queryClient: QueryClient): void {
  queryClient.removeQueries({
    predicate: (query) => !PUBLIC_QUERY_ROOTS.includes(String(query.queryKey[0])),
  });
}
