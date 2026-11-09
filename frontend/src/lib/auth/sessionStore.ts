import type { AuthUser, Session } from './types';

/**
 * Holds the session (access token + user) IN MEMORY only, never in localStorage/sessionStorage, so an injected
 * script cannot read the token from storage. After a reload the session is restored by calling the refresh
 * endpoint, which uses the HttpOnly cookie (see `refreshAccessToken` in lib/api/client.ts).
 *
 * Tabs share the refresh cookie but not memory, so they keep each other in sync over a BroadcastChannel:
 * - logout in one tab clears the session in every tab;
 * - login in one tab makes the other tabs refresh once, which picks up the new session from the shared cookie.
 * Only "login"/"logout" signals cross tabs, never tokens. Without BroadcastChannel each tab simply stays on its own.
 */
type Listener = (session: Session | null) => void;

type TabMessage = { type: 'login' } | { type: 'logout' };

export interface SessionStore {
  get(): Session | null;
  getAccessToken(): string | null;
  /** Replaces the session in this tab only (token refresh). */
  set(session: Session): void;
  /** Patches the user (e.g. after a profile change) and keeps the token. */
  updateUser(patch: Partial<AuthUser>): void;
  /** Clears the session in this tab only (refresh failed, or another tab logged out). */
  clear(): void;
  /** Starts a session after login and tells the other tabs. */
  signIn(session: Session): void;
  /** Ends the session here and in every other tab. */
  signOut(): void;
  /**
   * Changes whenever a session is started or ended on purpose. A token refresh that started earlier must not
   * apply its result afterwards (it would bring a logged-out session back to life).
   */
  generation(): number;
  subscribe(listener: Listener): () => void;
  /** Listens to the other tabs until the returned function is called. `onRemoteLogin` should refresh the session. */
  syncTabs(options: { onRemoteLogin: () => void }): () => void;
}

export function createSessionStore({ channelName = 'flighthotel-auth' }: { channelName?: string } = {}): SessionStore {
  let current: Session | null = null;
  let generation = 0;
  const listeners = new Set<Listener>();
  let channel: BroadcastChannel | null = null;
  let onRemoteLogin: (() => void) | null = null;

  function emit(): void {
    listeners.forEach((listener) => listener(current));
  }

  function replace(session: Session | null): void {
    if (session === current) {
      return;
    }
    current = session;
    emit();
  }

  function clearLocally(): void {
    generation++;
    replace(null);
  }

  function handleTabMessage(message: TabMessage | undefined): void {
    if (message?.type === 'logout') {
      clearLocally();
    } else if (message?.type === 'login') {
      onRemoteLogin?.();
    }
  }

  function broadcast(message: TabMessage): void {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    try {
      if (channel) {
        channel.postMessage(message);
        return;
      }
      // Not listening (yet): still tell the others, through a short-lived channel.
      const oneOff = new BroadcastChannel(channelName);
      oneOff.postMessage(message);
      oneOff.close();
    } catch (error) {
      console.warn('Could not share the login state with other tabs', error);
    }
  }

  return {
    get: () => current,
    getAccessToken: () => current?.accessToken ?? null,
    set: (session) => replace(session),
    updateUser(patch) {
      if (current) {
        replace({ ...current, user: { ...current.user, ...patch } });
      }
    },
    clear: clearLocally,
    signIn(session) {
      generation++;
      replace(session);
      broadcast({ type: 'login' });
    },
    signOut() {
      clearLocally();
      broadcast({ type: 'logout' });
    },
    generation: () => generation,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    syncTabs(options) {
      onRemoteLogin = options.onRemoteLogin;
      if (!channel && typeof BroadcastChannel !== 'undefined') {
        try {
          channel = new BroadcastChannel(channelName);
          channel.onmessage = (event: MessageEvent<TabMessage>) => handleTabMessage(event.data);
        } catch (error) {
          console.warn('Cross-tab login sync is unavailable', error);
          channel = null;
        }
      }
      return () => {
        onRemoteLogin = null;
        channel?.close();
        channel = null;
      };
    },
  };
}

/** The app-wide session. */
export const sessionStore = createSessionStore();
