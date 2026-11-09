import { useEffect, useRef, useState } from 'react';

import { useServerNow } from '@/app/providers/useRealtime';

/**
 * Seconds until `deadline` (an ISO instant), counted on the server's clock and updated every second. Until the first
 * tick it shows `initial`, so a page never flashes "expired" while it starts.
 */
export function useCountdown(deadline: string | null | undefined, initial = 15 * 60): number {
  const serverNow = useServerNow();
  const end = deadline ? new Date(deadline).getTime() : null;
  const nowRef = useRef(serverNow);
  useEffect(() => {
    nowRef.current = serverNow;
  });
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (end === null) {
      return undefined;
    }
    const tick = () => setRemaining(Math.max(0, Math.round((end - nowRef.current()) / 1000)));
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [end]);
  return end === null ? initial : (remaining ?? initial);
}

/** 125 → "2:05". */
export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
