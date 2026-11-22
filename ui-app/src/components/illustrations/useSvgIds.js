import { useId } from 'react';

/**
 * Ids for gradients and clip paths inside one drawing. They are unique per instance, so the same illustration can be
 * on a page twice without one borrowing the other's gradient. `url(ids.sky)` → `url(#fh-r1-sky)`.
 */
export function useSvgIds(...names) {
  const base = `fh${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const ids = Object.fromEntries(names.map((name) => [name, `${base}-${name}`]));
  return { ...ids, url: (name) => `url(#${base}-${name})` };
}
