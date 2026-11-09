import { createContext } from 'react';

import type { RealtimeStatus } from '@/lib/realtime/types';

export interface RealtimeContextValue {
  status: RealtimeStatus;
  /** serverTime - clientTime in ms; add it to Date.now() for accurate countdowns. */
  serverTimeOffsetMs: number;
}

export const RealtimeContext = createContext<RealtimeContextValue>({ status: 'idle', serverTimeOffsetMs: 0 });
