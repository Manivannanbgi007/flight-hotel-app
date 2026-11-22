import { createContext } from 'react';

export const RealtimeContext = createContext({ status: 'idle', serverTimeOffsetMs: 0 });
