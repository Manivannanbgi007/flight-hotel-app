import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Fades and lifts its content in when it scrolls into view (once). Without IntersectionObserver, and under
 * `prefers-reduced-motion`, the content is simply shown (index.css). Use it for page sections below the fold, never
 * for content the user needs at once (forms, errors).
 */
export function Reveal({ as: Component = 'div', delay = 0, className, children, ...rest }: {
  as?: ElementType;
  /** Milliseconds before the fade starts (stagger siblings with 0, 80, 160, …). */
  delay?: number;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = ref.current;
    if (revealed || !element) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [revealed]);

  return (
    <Component
      ref={ref}
      className={cn('reveal', className)}
      data-revealed={revealed ? '' : undefined}
      style={delay ? ({ '--reveal-delay': `${delay}ms` } as CSSProperties) : undefined}
      {...rest}
    >
      {children}
    </Component>
  );
}
