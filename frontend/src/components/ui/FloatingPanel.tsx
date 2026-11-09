import { forwardRef, useEffect, useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from 'react';

import { cn } from '@/lib/cn';
import { floatingPanelClass } from './fieldStyles';

const GAP = 6;
const MARGIN = 8;
/** Without the Popover API the attribute would only hide the panel (jsdom styles it but cannot show it). */
const POPOVER_API = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

export interface FloatingPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** The field the panel belongs to: it opens under it (or above, when there is more room there). */
  anchor: RefObject<HTMLElement | null>;
  /** A press outside the panel and the anchor (the panel does not close itself). */
  onDismiss: () => void;
  /** At least as wide as the anchor (lists); a calendar keeps its own width. */
  matchWidth?: boolean;
}

/**
 * The floating part of a picker (calendar, time list, suggestions). Render it only while open.
 *
 * It is shown in the browser's top layer (Popover API), so it is never clipped by a scrolling dialog or card and
 * always sits above them, while staying inside its field in the DOM (a dialog's focus trap includes it). It follows
 * the field on scroll and resize and opens upwards when there is not enough room below. Without the Popover API
 * (older browsers, jsdom) it is a fixed panel with a high z-index.
 */
export const FloatingPanel = forwardRef<HTMLDivElement, FloatingPanelProps>(function FloatingPanel(
  { anchor, onDismiss, matchWidth = false, className, children, ...rest },
  forwardedRef,
) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    if (POPOVER_API) {
      try {
        panel.showPopover();
      } catch {
        // Already open, or not connected yet: the fixed position still applies.
      }
    }

    let frame = 0;
    const place = () => {
      const field = anchor.current;
      if (!field) return;
      const rect = field.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = window.innerHeight;
      if (matchWidth) panel.style.minWidth = `${Math.round(rect.width)}px`;
      panel.style.maxHeight = '';
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const below = viewportHeight - rect.bottom - GAP - MARGIN;
      const above = rect.top - GAP - MARGIN;
      const upwards = height > below && above > below;
      const room = Math.max(upwards ? above : below, 160);
      if (height > room) panel.style.maxHeight = `${Math.floor(room)}px`;
      const shownHeight = Math.min(height, room);
      const top = upwards ? Math.max(MARGIN, rect.top - GAP - shownHeight) : rect.bottom + GAP;
      const left = Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, viewportWidth - MARGIN - width));
      panel.style.top = `${Math.round(top)}px`;
      panel.style.left = `${Math.round(left)}px`;
      panel.dataset.placement = upwards ? 'top' : 'bottom';
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    // The content can change size after it opens (a month with six weeks, results arriving).
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(panel);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      if (POPOVER_API) {
        try {
          panel.hidePopover();
        } catch {
          // Already closed.
        }
      }
    };
  }, [anchor, matchWidth]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || panelRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onDismissRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchor]);

  return (
    <div
      ref={(node) => {
        panelRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      popover={POPOVER_API ? 'manual' : undefined}
      className={cn(
        // Undo the browser's popover box (centred, inset 0, border, padding) and place it ourselves.
        'fixed inset-auto z-[70] m-0 overflow-auto overscroll-contain animate-scale-in',
        'origin-top data-[placement=top]:origin-bottom',
        floatingPanelClass,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
