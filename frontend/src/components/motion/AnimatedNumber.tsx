import { useEffect, useRef, useState } from 'react';

import { useReducedMotion } from '@/lib/useReducedMotion';

const defaultFormat = new Intl.NumberFormat('en-IN');

/**
 * A number that counts up (or down) to `value` with an ease-out, e.g. KPI figures. Screen readers get only the final
 * value (the moving digits are hidden from them); under reduced motion the final value shows at once.
 */
export function AnimatedNumber({ value, format = (n) => defaultFormat.format(Math.round(n)), duration = 900, className }: {
  value: number;
  format?: (value: number) => string;
  duration?: number;
  className?: string;
}) {
  const reduced = useReducedMotion() || typeof requestAnimationFrame === 'undefined';
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (reduced) {
      return undefined;
    }
    const from = fromRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      // A frame's timestamp can be a little before `start` (it is the frame's start time): never go below 0.
      const progress = Math.max(0, Math.min(1, (now - start) / duration));
      const eased = 1 - (1 - progress) ** 3;
      const current = from + (value - from) * eased;
      fromRef.current = current;
      setShown(current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  return (
    <span className={className}>
      <span aria-hidden="true">{format(reduced ? value : shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
