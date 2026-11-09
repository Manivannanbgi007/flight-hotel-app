import { customer } from '@/test/renderRoutes';
import { createSessionStore } from './sessionStore';
import type { Session } from './types';

/** BroadcastChannel stand-in: delivers synchronously to the other open channels of the same name (never to itself). */
class FakeChannel {
  static open = new Set<FakeChannel>();
  static posted: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly name: string) {
    FakeChannel.open.add(this);
  }

  postMessage(data: unknown) {
    FakeChannel.posted.push(data);
    for (const other of FakeChannel.open) {
      if (other !== this && other.name === this.name) other.onmessage?.({ data } as MessageEvent);
    }
  }

  close() {
    FakeChannel.open.delete(this);
  }
}

const session = (token = 'token-1'): Session => ({ accessToken: token, user: customer });

beforeEach(() => {
  FakeChannel.open.clear();
  FakeChannel.posted = [];
  vi.stubGlobal('BroadcastChannel', FakeChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session store (one tab)', () => {
  it('keeps the session in memory and tells subscribers about changes', () => {
    const store = createSessionStore({ channelName: 'test' });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.get()).toBeNull();
    expect(store.getAccessToken()).toBeNull();

    const first = session();
    store.set(first);
    store.set(first);

    expect(store.getAccessToken()).toBe('token-1');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(first);

    unsubscribe();
    store.set(session('token-2'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('patches the user and keeps the token; does nothing when logged out', () => {
    const store = createSessionStore({ channelName: 'test' });
    store.updateUser({ firstName: 'Nobody' });
    expect(store.get()).toBeNull();

    store.set(session());
    store.updateUser({ firstName: 'Ashwini', hasPhoto: true });

    expect(store.get()).toEqual({ accessToken: 'token-1', user: { ...customer, firstName: 'Ashwini', hasPhoto: true } });
  });

  it('counts deliberate logins and logouts, but not token refreshes', () => {
    const store = createSessionStore({ channelName: 'test' });
    const start = store.generation();

    store.set(session());
    expect(store.generation()).toBe(start);
    store.signIn(session());
    expect(store.generation()).toBe(start + 1);
    store.clear();
    expect(store.generation()).toBe(start + 2);
    store.signOut();
    expect(store.generation()).toBe(start + 3);
    expect(store.get()).toBeNull();
  });
});

describe('session store (several tabs)', () => {
  it('logging out in one tab logs out every listening tab', () => {
    const tabA = createSessionStore({ channelName: 'auth' });
    const tabB = createSessionStore({ channelName: 'auth' });
    tabA.syncTabs({ onRemoteLogin: vi.fn() });
    tabB.syncTabs({ onRemoteLogin: vi.fn() });
    tabA.set(session('a-token'));
    tabB.set(session('b-token'));
    const listenerB = vi.fn();
    tabB.subscribe(listenerB);
    const generationB = tabB.generation();

    tabA.signOut();

    expect(tabA.get()).toBeNull();
    expect(tabB.get()).toBeNull();
    expect(listenerB).toHaveBeenCalledWith(null);
    expect(tabB.generation()).toBe(generationB + 1);
  });

  it('a login in one tab asks the others to refresh, without sending the token', () => {
    const tabA = createSessionStore({ channelName: 'auth' });
    const tabB = createSessionStore({ channelName: 'auth' });
    const onRemoteLoginA = vi.fn();
    const onRemoteLoginB = vi.fn();
    tabA.syncTabs({ onRemoteLogin: onRemoteLoginA });
    tabB.syncTabs({ onRemoteLogin: onRemoteLoginB });

    tabA.signIn(session('secret-token'));

    expect(onRemoteLoginB).toHaveBeenCalledTimes(1);
    expect(onRemoteLoginA).not.toHaveBeenCalled();
    expect(tabB.get()).toBeNull();
    expect(FakeChannel.posted).toEqual([{ type: 'login' }]);
    expect(JSON.stringify(FakeChannel.posted)).not.toContain('secret-token');
  });

  it('a tab that is not listening still tells the others, through a short-lived channel', () => {
    const listening = createSessionStore({ channelName: 'auth' });
    const notListening = createSessionStore({ channelName: 'auth' });
    listening.syncTabs({ onRemoteLogin: vi.fn() });
    listening.set(session());

    notListening.signOut();

    expect(listening.get()).toBeNull();
    // Only the listening tab's own channel stays open.
    expect(FakeChannel.open.size).toBe(1);
  });

  it('stops listening when asked to', () => {
    const tabA = createSessionStore({ channelName: 'auth' });
    const tabB = createSessionStore({ channelName: 'auth' });
    const onRemoteLogin = vi.fn();
    tabA.syncTabs({ onRemoteLogin: vi.fn() });
    const stop = tabB.syncTabs({ onRemoteLogin });
    tabB.set(session());

    stop();
    tabA.signIn(session('a'));
    tabA.signOut();

    expect(onRemoteLogin).not.toHaveBeenCalled();
    expect(tabB.get()).not.toBeNull();
  });

  it('ignores unknown messages', () => {
    const tabA = createSessionStore({ channelName: 'auth' });
    tabA.syncTabs({ onRemoteLogin: vi.fn() });
    tabA.set(session());

    new FakeChannel('auth').postMessage({ type: 'something-else' });
    new FakeChannel('auth').postMessage(undefined);

    expect(tabA.get()).not.toBeNull();
  });

  it('works on its own where BroadcastChannel does not exist', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const store = createSessionStore({ channelName: 'auth' });

    const stop = store.syncTabs({ onRemoteLogin: vi.fn() });
    store.signIn(session());
    expect(store.getAccessToken()).toBe('token-1');
    store.signOut();
    expect(store.get()).toBeNull();
    stop();
  });

  it('keeps working when the channel cannot be opened', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('BroadcastChannel', class {
      constructor() {
        throw new Error('blocked by the browser');
      }
    });
    const store = createSessionStore({ channelName: 'auth' });

    store.syncTabs({ onRemoteLogin: vi.fn() });
    store.signIn(session());

    expect(store.getAccessToken()).toBe('token-1');
    expect(warn).toHaveBeenCalledWith('Cross-tab login sync is unavailable', expect.any(Error));
    expect(warn).toHaveBeenCalledWith('Could not share the login state with other tabs', expect.any(Error));
  });
});
