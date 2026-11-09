import { useContext, useEffect, useRef } from 'react';

import { realtimeBus, type RealtimeHandler } from '@/lib/realtime/eventBus';
import type { RealtimeStatus } from '@/lib/realtime/types';
import { RealtimeContext } from './realtimeContext';

export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeContext).status;
}

/** Current time corrected to the server clock. Use it for payment-window and quote-expiry countdowns. */
export function useServerNow(): () => number {
  const { serverTimeOffsetMs } = useContext(RealtimeContext);
  return () => Date.now() + serverTimeOffsetMs;
}

/**
 * Run `handler` for every live message of `type` (or `'*'`).
 * The latest handler is always used, so callers don't need to memoize it.
 */
export function useRealtimeEvent(type: string, handler: RealtimeHandler): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => realtimeBus.subscribe(type, (message) => handlerRef.current(message)), [type]);
}

/**
 * Polling fallback for status-critical screens (booking processing, payment result): returns `intervalMs` while
 * live updates are not connected, otherwise `false`. Pass the result to TanStack Query's `refetchInterval`.
 */
export function usePollingFallback(intervalMs = 5_000): number | false {
  return useRealtimeStatus() === 'connected' ? false : intervalMs;
}
