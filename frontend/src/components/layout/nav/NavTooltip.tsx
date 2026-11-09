import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The name of a collapsed sidebar link, shown beside it on hover and keyboard focus. Fixed to the window and drawn in
 * `document.body`: the sidebar is sticky (its own stacking context), so a tooltip left inside it would slide under any
 * banner or card of the page that has its own layer. Visual only: the link keeps its name for screen readers.
 */
export function NavTooltip({ label, enabled, children }: { label: string; enabled: boolean; children: ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const shown = enabled && position !== null;

  useEffect(() => {
    if (!shown) return undefined;
    const hide = () => setPosition(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [shown]);

  const show = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    // Kept inside the window (a link near the top or bottom edge must not push its label out of sight).
    if (enabled && rect) setPosition({ top: Math.min(Math.max(rect.top + rect.height / 2, 24), window.innerHeight - 24), left: rect.right + 12 });
  };

  return (
    <span ref={anchorRef} className="block" onPointerEnter={show} onPointerLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)}>
      {children}
      {shown && createPortal(
        <span
          aria-hidden="true"
          data-nav-tooltip=""
          style={{ top: position.top, left: position.left }}
          className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold leading-none text-white shadow-lg ring-1 ring-white/10 animate-[nav-tooltip-in_140ms_var(--ease-out-soft)_both] motion-reduce:animate-none"
        >
          <span className="absolute left-0 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-slate-900" />
          {label}
        </span>,
        document.body,
      )}
    </span>
  );
}
