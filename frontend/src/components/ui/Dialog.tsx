import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { cn } from '@/lib/cn';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** One or two sentences under the title (read out with it). */
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** A small tile before the title (decorative). */
  icon?: ReactNode;
  /**
   * `panel` (default): the whole dialog scrolls. `body`: the title row stays and only the content scrolls, in one box
   * for both directions (long tables, comparisons); the content brings its own padding. On phones a `body` dialog is a
   * full-width sheet from the bottom.
   */
  scroll?: 'panel' | 'body';
}

/**
 * Modal dialog: focus moves into it (the first field or button), Tab stays inside, Escape and the close button close
 * it, and focus goes back to where it was. Rendered in `document.body`, above the page.
 */
export function Dialog({ open, onClose, title, description, children, className, icon, scroll = 'panel' }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // `data-autofocus` wins; otherwise the first field or button of the content (not the close button).
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) {
        return;
      }
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) {
    return null;
  }
  const bodyScroll = scroll === 'body';
  const closeButton = (
    <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 shrink-0 rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800">
      <X className="size-5" aria-hidden="true" />
    </button>
  );
  const heading = (
    <div className="min-w-0 flex-1">
      <h2 id={titleId} className="text-lg font-bold text-slate-900">{title}</h2>
      {description && <p id={descriptionId} className="mt-1 text-sm text-slate-600">{description}</p>}
    </div>
  );
  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 backdrop-blur-sm animate-fade-in sm:items-center',
        bodyScroll ? 'pt-6 sm:p-4' : 'p-4',
      )}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'w-full bg-white shadow-2xl ring-1 ring-slate-900/5 animate-scale-in',
          bodyScroll
            ? 'flex max-h-[92dvh] flex-col overflow-hidden rounded-t-3xl sm:max-h-[90dvh] sm:rounded-3xl'
            : 'max-h-[90dvh] overflow-y-auto rounded-3xl p-6',
          // `cn` does not merge Tailwind classes, so a caller's own max-w-* replaces the default instead of competing with it.
          !/(^|\s)max-w-/.test(className ?? '') && 'max-w-lg',
          className,
        )}
      >
        {bodyScroll ? (
          <>
            <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-5 py-4 sm:px-6 sm:py-5">
              {icon && <span aria-hidden="true" className="flex shrink-0">{icon}</span>}
              {heading}
              {closeButton}
            </div>
            {children && (
              <div
                ref={bodyRef}
                className="min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-color:var(--color-slate-300)_transparent] [scrollbar-width:thin]"
              >
                {children}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              {icon && <span aria-hidden="true" className="flex shrink-0">{icon}</span>}
              <h2 id={titleId} className={cn('text-lg font-bold text-slate-900', icon && 'flex-1')}>{title}</h2>
              {closeButton}
            </div>
            {description && <p id={descriptionId} className="mt-1 text-sm text-slate-600">{description}</p>}
            {children && <div ref={bodyRef} className="mt-4">{children}</div>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
