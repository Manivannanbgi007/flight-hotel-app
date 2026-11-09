import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/cn';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A sidebar on phones and small tablets: a modal panel that slides in from the left. Focus moves inside (to the close
 * button), Tab stays inside, Escape or a tap outside closes it, the page behind does not scroll, and the focus goes
 * back to the button that opened it.
 */
export function NavDrawer({ label, onClose, returnFocus, className, children }: {
  /** The dialog's name ("Admin portal navigation"). */
  label: string;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = returnFocus.current;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [returnFocus]);

  return (
    <div className={cn('fixed inset-0 z-50', className)}>
      <div aria-hidden="true" className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative flex h-full w-[min(18.5rem,86vw)] flex-col overflow-hidden bg-white shadow-2xl animate-slide-in-left"
      >
        {children}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="absolute right-2.5 top-3 rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
