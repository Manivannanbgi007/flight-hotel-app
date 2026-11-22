export function createSessionStore({ channelName = 'flighthotel-auth' } = {}) {
  let current = null;
  let generation = 0;
  const listeners = new Set();
  let channel = null;
  let onRemoteLogin = null;

  function emit() {
    listeners.forEach((listener) => listener(current));
  }

  function replace(session) {
    if (session === current) {
      return;
    }
    current = session;
    emit();
  }

  function clearLocally() {
    generation++;
    replace(null);
  }

  function handleTabMessage(message) {
    if (message?.type === 'logout') {
      clearLocally();
    } else if (message?.type === 'login') {
      onRemoteLogin?.();
    }
  }

  function broadcast(message) {
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
          channel.onmessage = (event) => handleTabMessage(event.data);
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
