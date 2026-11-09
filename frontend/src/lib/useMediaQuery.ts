import { useCallback, useSyncExternalStore } from 'react';

/** True while the media query matches (false without matchMedia, e.g. on the server or in old test setups). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [query],
  );
  const snapshot = useCallback(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
