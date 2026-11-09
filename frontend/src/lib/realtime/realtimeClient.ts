import { SseParser, type SseEvent } from './sseParser';
import type { RealtimeMessage, RealtimeStatus } from './types';

export interface RealtimeClientOptions {
  /** Stream endpoint, e.g. `/api/realtime/stream`. */
  url: string;
  /** Current access token, or null when logged out. */
  getAccessToken: () => string | null;
  /** Gets a new access token. Resolves `false` when the user must log in again. */
  refreshAccessToken: () => Promise<boolean>;
  onMessage: (message: RealtimeMessage) => void;
  onStatusChange: (status: RealtimeStatus) => void;
  /** Called after a REconnect: messages may have been missed, so visible data should be re-fetched. */
  onResync: () => void;
  /** Server clock at connect time (ms since epoch), to correct countdown timers. */
  onServerTime?: (serverTimeMs: number) => void;
  /** Reconnect if nothing (not even a heartbeat) arrives for this long. Server pings every 25 s. */
  heartbeatTimeoutMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** For tests. */
  fetchImpl?: typeof fetch;
  random?: () => number;
}

const MAX_CONSECUTIVE_UNAUTHORIZED = 2;
/** When another tab/device took over our slot (TOO_MANY_STREAMS) we wait longer before trying again. */
const EVICTED_BACKOFF_MS = 60_000;

/**
 * Keeps one Server-Sent Events connection open while the user is logged in.
 *
 * Production behaviour:
 * - sends the bearer token (fetch-based, so headers are possible)
 * - reconnects with exponential backoff + full jitter (1 s → 30 s), so a server restart does not cause a
 *   thundering herd of reconnects
 * - watchdog: reconnects if no data/heartbeat arrives within `heartbeatTimeoutMs`
 * - handles 401 (refresh token once, then give up), `token-expired`, `reconnect` (server deploy),
 *   `closed` (evicted) events, and the browser's online/offline events
 */
export class RealtimeClient {
  private readonly options: Required<Omit<RealtimeClientOptions, 'onServerTime'>> &
    Pick<RealtimeClientOptions, 'onServerTime'>;
  private running = false;
  private status: RealtimeStatus = 'idle';
  private controller: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private consecutiveUnauthorized = 0;
  private hasConnectedBefore = false;
  private lastEventId: string | undefined;
  private connectionGeneration = 0;

  constructor(options: RealtimeClientOptions) {
    this.options = {
      heartbeatTimeoutMs: 60_000,
      minBackoffMs: 1_000,
      maxBackoffMs: 30_000,
      fetchImpl: (input, init) => fetch(input, init),
      random: Math.random,
      ...options,
    };
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    void this.connect();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    this.clearTimers();
    this.abortCurrent();
    this.setStatus('idle');
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  private readonly handleOnline = (): void => {
    if (this.running && this.status === 'offline') {
      this.attempt = 0;
      void this.connect();
    }
  };

  private readonly handleOffline = (): void => {
    if (this.running) {
      this.clearTimers();
      this.abortCurrent();
      this.setStatus('offline');
    }
  };

  private async connect(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.clearTimers();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus('offline');
      return;
    }
    const token = this.options.getAccessToken();
    if (!token) {
      // Logged out (or token not loaded yet): nothing to connect with.
      this.stop();
      return;
    }

    this.setStatus(this.hasConnectedBefore ? 'reconnecting' : 'connecting');
    const generation = ++this.connectionGeneration;
    const controller = new AbortController();
    this.controller = controller;

    try {
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      };
      if (this.lastEventId) {
        headers['Last-Event-ID'] = this.lastEventId;
      }
      const response = await this.options.fetchImpl(this.options.url, {
        headers,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'same-origin',
      });

      if (response.status === 401) {
        await this.handleUnauthorized();
        return;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok || !response.body || !contentType.includes('text/event-stream')) {
        this.scheduleReconnect(retryAfterMs(response));
        return;
      }

      this.consecutiveUnauthorized = 0;
      await this.readStream(response.body, generation);
      // The server ended the stream normally (e.g. max lifetime). Reconnect.
      if (this.isCurrent(generation)) {
        this.scheduleReconnect();
      }
    } catch {
      // Network error or abort. Aborts we caused ourselves are handled by whoever aborted.
      if (this.isCurrent(generation) && !controller.signal.aborted) {
        this.scheduleReconnect();
      }
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>, generation: number): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser(
      (event) => this.handleEvent(event, generation),
      () => undefined,
    );
    this.resetWatchdog(generation);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || !this.isCurrent(generation)) {
          break;
        }
        this.resetWatchdog(generation);
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
    }
  }

  private handleEvent(event: SseEvent, generation: number): void {
    if (!this.isCurrent(generation)) {
      return;
    }
    switch (event.event) {
      case 'connected': {
        const reconnected = this.hasConnectedBefore;
        this.hasConnectedBefore = true;
        this.attempt = 0;
        this.setStatus('connected');
        const info = safeJson<{ serverTime?: string }>(event.data);
        if (info?.serverTime && this.options.onServerTime) {
          this.options.onServerTime(Date.parse(info.serverTime));
        }
        if (reconnected) {
          this.options.onResync();
        }
        break;
      }
      case 'message': {
        if (event.id) {
          this.lastEventId = event.id;
        }
        const message = safeJson<RealtimeMessage>(event.data);
        if (message?.type) {
          this.options.onMessage(message);
        }
        break;
      }
      case 'token-expired':
        this.abortCurrent();
        void this.refreshThenReconnect();
        break;
      case 'reconnect':
        // Server is shutting down (deploy). Spread reconnects over up to 3 s.
        this.abortCurrent();
        this.scheduleReconnect(Math.floor(this.options.random() * 3_000));
        break;
      case 'closed':
        // Too many open streams for this user: another tab/device took our slot.
        this.abortCurrent();
        this.scheduleReconnect(EVICTED_BACKOFF_MS);
        break;
      default:
        break;
    }
  }

  private async handleUnauthorized(): Promise<void> {
    this.consecutiveUnauthorized++;
    if (this.consecutiveUnauthorized > MAX_CONSECUTIVE_UNAUTHORIZED) {
      this.stop();
      return;
    }
    await this.refreshThenReconnect();
  }

  private async refreshThenReconnect(): Promise<void> {
    if (!this.running) {
      return;
    }
    const refreshed = await this.options.refreshAccessToken().catch(() => false);
    if (!refreshed) {
      // Session is over; the auth layer redirects to login.
      this.stop();
      return;
    }
    void this.connect();
  }

  private scheduleReconnect(delayOverrideMs?: number): void {
    if (!this.running) {
      return;
    }
    this.clearTimers();
    this.abortCurrent();
    this.attempt++;
    const { minBackoffMs, maxBackoffMs } = this.options;
    const ceiling = Math.min(maxBackoffMs, minBackoffMs * 2 ** (this.attempt - 1));
    const delay = delayOverrideMs ?? Math.max(250, Math.floor(this.options.random() * ceiling));
    this.setStatus(this.status === 'offline' ? 'offline' : 'reconnecting');
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private resetWatchdog(generation: number): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
    }
    this.watchdogTimer = setTimeout(() => {
      if (this.isCurrent(generation)) {
        this.scheduleReconnect();
      }
    }, this.options.heartbeatTimeoutMs);
  }

  private abortCurrent(): void {
    if (this.controller) {
      this.connectionGeneration++;
      this.controller.abort();
      this.controller = null;
    }
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private isCurrent(generation: number): boolean {
    return this.running && generation === this.connectionGeneration;
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.options.onStatusChange(status);
    }
  }
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) {
    return undefined;
  }
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) ? Math.min(seconds, 120) * 1_000 : undefined;
}
