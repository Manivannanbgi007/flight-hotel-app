/** A "something changed" signal from the server. See REALTIME_UPDATES.md §3. */
export interface RealtimeMessage<TData = Record<string, unknown>> {
  id: string;
  type: string;
  resourceType: string;
  resourceId: string | null;
  data: TData;
  occurredAt: string;
  correlationId?: string | null;
}

/**
 * - idle: not started (logged out)
 * - connecting: first connection attempt
 * - connected: live updates are flowing
 * - reconnecting: connection lost, retrying with backoff
 * - offline: the browser has no network
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

/** Synthetic message published on the client bus after a reconnect: data may have changed while disconnected. */
export const RESYNC_EVENT = 'realtime.resync';
