import { cloneElement, isValidElement, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Side = 'top' | 'bottom';

/**
 * A short hint shown on hover and keyboard focus of its trigger (WCAG 1.4.13: it stays while hovered, Escape hides
 * it). The trigger is described by the text (`aria-describedby`), so screen readers read it too. The trigger must be a
 * single focusable element (button, link); never put essential information only in a tooltip.
 */
export function Tooltip({ content, children, side = 'top', className }: {
  content: ReactNode;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: Side;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const trigger = isValidElement(children)
    ? cloneElement(children, { 'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' ') })
    : children;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {trigger}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          open ? 'animate-fade-in' : 'sr-only',
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
