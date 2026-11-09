import type { RealtimeMessage, RealtimeStatus } from './types';

/** Minimal interface of the connection owned by the leader tab (implemented by RealtimeClient). */
export interface RealtimeConnection {
  start(): void;
  stop(): void;
}

export interface ConnectionHandlers {
  onMessage: (message: RealtimeMessage) => void;
  onStatusChange: (status: RealtimeStatus) => void;
  onResync: () => void;
}

export interface TabCoordinatorOptions extends ConnectionHandlers {
  createConnection: (handlers: ConnectionHandlers) => RealtimeConnection;
  lockName?: string;
  channelName?: string;
}

type ChannelMessage =
  | { kind: 'message'; message: RealtimeMessage }
  | { kind: 'status'; status: RealtimeStatus }
  | { kind: 'resync' }
  | { kind: 'status-request' };

/**
 * Keeps ONE realtime connection per browser instead of one per tab.
 *
 * Tabs elect a leader with the Web Locks API. The leader opens the SSE connection and forwards everything to the
 * other tabs through a BroadcastChannel. When the leader tab closes, the browser releases its lock and another tab
 * takes over automatically, and then tells every tab to re-sync, since messages may have been missed during the switch.
 *
 * Browsers without Web Locks or BroadcastChannel fall back to one connection per tab.
 */
export class TabCoordinator {
  private readonly lockName: string;
  private readonly channelName: string;
  private channel: BroadcastChannel | null = null;
  private connection: RealtimeConnection | null = null;
  private lockAbort: AbortController | null = null;
  private releaseLock: (() => void) | null = null;
  private isLeader = false;
  private leaderStatus: RealtimeStatus = 'idle';
  private started = false;

  constructor(private readonly options: TabCoordinatorOptions) {
    this.lockName = options.lockName ?? 'flighthotel-realtime-leader';
    this.channelName = options.channelName ?? 'flighthotel-realtime';
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    if (!supportsCoordination()) {
      this.connection = this.options.createConnection(this.options);
      this.connection.start();
      return;
    }

    this.channel = new BroadcastChannel(this.channelName);
    this.channel.onmessage = (event: MessageEvent<ChannelMessage>) => this.onChannelMessage(event.data);
    this.options.onStatusChange('connecting');
    void this.waitForLeadership();
    // Ask an existing leader for its current status.
    this.channel.postMessage({ kind: 'status-request' } satisfies ChannelMessage);
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.lockAbort?.abort();
    this.lockAbort = null;
    this.connection?.stop();
    this.connection = null;
    this.releaseLock?.();
    this.releaseLock = null;
    this.isLeader = false;
    this.channel?.close();
    this.channel = null;
    this.options.onStatusChange('idle');
  }

  private async waitForLeadership(): Promise<void> {
    const lockAbort = new AbortController();
    this.lockAbort = lockAbort;
    let takingOverFromAnotherTab = false;
    try {
      const state = await navigator.locks.query();
      takingOverFromAnotherTab = (state.held ?? []).some((lock) => lock.name === this.lockName);
    } catch {
      // query() is optional; worst case we skip one re-sync.
    }

    try {
      await navigator.locks.request(this.lockName, { signal: lockAbort.signal }, () => {
        if (!this.started) {
          return Promise.resolve();
        }
        this.becomeLeader(takingOverFromAnotherTab);
        // Hold the lock until stop() (or the tab closes).
        return new Promise<void>((resolve) => {
          this.releaseLock = resolve;
        });
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('Realtime leader election failed; using a direct connection', error);
        if (this.started && !this.connection) {
          this.becomeLeader(false);
        }
      }
    }
  }

  private becomeLeader(takingOver: boolean): void {
    this.isLeader = true;
    let firstConnect = true;
    this.connection = this.options.createConnection({
      onMessage: (message) => {
        this.options.onMessage(message);
        this.post({ kind: 'message', message });
      },
      onStatusChange: (status) => {
        this.leaderStatus = status;
        this.options.onStatusChange(status);
        this.post({ kind: 'status', status });
        if (status === 'connected' && firstConnect) {
          firstConnect = false;
          if (takingOver) {
            this.options.onResync();
            this.post({ kind: 'resync' });
          }
        }
      },
      onResync: () => {
        this.options.onResync();
        this.post({ kind: 'resync' });
      },
    });
    this.connection.start();
  }

  private onChannelMessage(data: ChannelMessage): void {
    if (this.isLeader) {
      if (data.kind === 'status-request') {
        this.post({ kind: 'status', status: this.leaderStatus });
      }
      return;
    }
    switch (data.kind) {
      case 'message':
        this.options.onMessage(data.message);
        break;
      case 'status':
        this.options.onStatusChange(data.status);
        break;
      case 'resync':
        this.options.onResync();
        break;
      default:
        break;
    }
  }

  private post(message: ChannelMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch (error) {
      console.warn('Could not share realtime message with other tabs', error);
    }
  }
}

function supportsCoordination(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'locks' in navigator &&
    typeof navigator.locks?.request === 'function' &&
    typeof BroadcastChannel !== 'undefined'
  );
}
