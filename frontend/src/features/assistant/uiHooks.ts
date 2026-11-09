import { useCallback, useState, useSyncExternalStore } from 'react';

/** True while the media query matches (false where matchMedia is missing). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window.matchMedia !== 'function') return () => undefined;
    const media = window.matchMedia(query);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}

/** An on/off preference remembered on this device (`localStorage`; works without it, just not remembered). */
export function useStoredFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === 'true';
    } catch {
      return initial;
    }
  });
  const update = useCallback((next: boolean) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      // Not remembered.
    }
  }, [key]);
  return [value, update];
}
