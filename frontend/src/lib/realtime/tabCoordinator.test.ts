import { TabCoordinator, type ConnectionHandlers } from './tabCoordinator';
import type { RealtimeMessage, RealtimeStatus } from './types';

/** In-memory stand-in for the Web Locks API shared by "tabs" in one test. */
class FakeLocks {
  private holder: Promise<unknown> | null = null;
  private readonly waiters: (() => void)[] = [];
  held = false;

  async query() {
    return { held: this.held ? [{ name: 'test-lock' }] : [], pending: [] };
  }

  async request(_name: string, options: { signal?: AbortSignal }, callback: () => Promise<unknown>) {
    while (this.holder) {
      await new Promise<void>((resolve, reject) => {
        this.waiters.push(resolve);
        options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    this.held = true;
    this.holder = callback();
    await this.holder;
    this.holder = null;
    this.held = false;
    this.waiters.shift()?.();
  }
}

const message: RealtimeMessage = {
  id: '1',
  type: 'notification.created',
  resourceType: 'NOTIFICATION',
  resourceId: 'n1',
  data: {},
  occurredAt: '2026-11-02T10:00:00Z',
};

function tab(createdConnections: ConnectionHandlers[]) {
  const received: RealtimeMessage[] = [];
  const statuses: RealtimeStatus[] = [];
  const onResync = vi.fn();
  const coordinator = new TabCoordinator({
    lockName: 'test-lock',
    channelName: 'test-channel',
    createConnection: (handlers) => {
      createdConnections.push(handlers);
      return { start: vi.fn(), stop: vi.fn() };
    },
    onMessage: (m) => received.push(m),
    onStatusChange: (s) => statuses.push(s),
    onResync,
  });
  return { coordinator, received, statuses, onResync };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('TabCoordinator', () => {
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');

  beforeEach(() => {
    Object.defineProperty(navigator, 'locks', { value: new FakeLocks(), configurable: true });
  });
  afterEach(() => {
    if (originalLocks) {
      Object.defineProperty(navigator, 'locks', originalLocks);
    } else {
      delete (navigator as { locks?: unknown }).locks;
    }
  });

  it('opens one connection for two tabs and shares messages with the follower', async () => {
    const connections: ConnectionHandlers[] = [];
    const leader = tab(connections);
    const follower = tab(connections);

    leader.coordinator.start();
    await tick();
    follower.coordinator.start();
    await tick();

    expect(connections).toHaveLength(1);
    connections[0]!.onStatusChange('connected');
    connections[0]!.onMessage(message);
    await tick();

    expect(leader.received).toEqual([message]);
    expect(follower.received).toEqual([message]);
    expect(follower.statuses.at(-1)).toBe('connected');

    leader.coordinator.stop();
    follower.coordinator.stop();
  });

  it('lets a follower take over when the leader closes, and re-syncs', async () => {
    const connections: ConnectionHandlers[] = [];
    const leader = tab(connections);
    const follower = tab(connections);
    leader.coordinator.start();
    await tick();
    follower.coordinator.start();
    await tick();

    leader.coordinator.stop();
    await tick();

    expect(connections).toHaveLength(2);
    connections[1]!.onStatusChange('connected');
    expect(follower.onResync).toHaveBeenCalledOnce();

    follower.coordinator.stop();
  });

  it('falls back to a direct connection without Web Locks', () => {
    delete (navigator as { locks?: unknown }).locks;
    const connections: ConnectionHandlers[] = [];
    const single = tab(connections);

    single.coordinator.start();

    expect(connections).toHaveLength(1);
    single.coordinator.stop();
  });
});
