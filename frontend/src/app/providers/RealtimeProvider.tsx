import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { refreshAccessToken } from '@/lib/api/client';
import { sessionStore } from '@/lib/auth/sessionStore';
import { realtimeBus } from '@/lib/realtime/eventBus';
import { applyInvalidation } from '@/lib/realtime/invalidationRules';
import { RealtimeClient } from '@/lib/realtime/realtimeClient';
import { TabCoordinator } from '@/lib/realtime/tabCoordinator';
import { RESYNC_EVENT, type RealtimeStatus } from '@/lib/realtime/types';
import { RealtimeContext } from './realtimeContext';

/**
 * Opens the live-update connection while the user is logged in, and:
 * 1. refreshes the affected TanStack Query caches for every server message (invalidationRules.ts),
 * 2. publishes every message on the client event bus for components that want to react (toasts, badges),
 * 3. re-fetches visible data after a reconnect.
 *
 * The connection is keyed on the user id: token refreshes keep it open, a different user gets a new one.
 *
 * Hooks for components are in useRealtime.ts.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const userId = useSyncExternalStore(sessionStore.subscribe, currentUserId);

  useEffect(() => {
    if (!userId) {
      return undefined;
    }
    const coordinator = new TabCoordinator({
      createConnection: (handlers) =>
        new RealtimeClient({
          url: '/api/realtime/stream',
          getAccessToken: sessionStore.getAccessToken,
          refreshAccessToken,
          onServerTime: (serverTimeMs) => setServerTimeOffsetMs(serverTimeMs - Date.now()),
          ...handlers,
        }),
      onMessage: (message) => {
        applyInvalidation(queryClient, message);
        realtimeBus.publish(message);
      },
      onStatusChange: setStatus,
      onResync: () => {
        void queryClient.invalidateQueries({ refetchType: 'active' });
        realtimeBus.publish({
          id: crypto.randomUUID(),
          type: RESYNC_EVENT,
          resourceType: 'CLIENT',
          resourceId: null,
          data: {},
          occurredAt: new Date().toISOString(),
        });
      },
    });
    coordinator.start();
    return () => coordinator.stop();
  }, [userId, queryClient]);

  const value = useMemo(() => ({ status, serverTimeOffsetMs }), [status, serverTimeOffsetMs]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

function currentUserId(): string | null {
  return sessionStore.get()?.user.id ?? null;
}
