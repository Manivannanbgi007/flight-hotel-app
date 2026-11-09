import { useEffect, useRef, useState, type RefObject } from 'react';

/** Space kept between the launcher and a bar it moves above. */
const GAP = 12;

/**
 * Lifts the floating launcher above what it must never cover, so their buttons stay clickable:
 * - bars that stick to the bottom of the screen (a sticky save bar, a compare tray);
 * - controls marked `data-assistant-avoid` (table pagination) while they pass underneath it.
 * Pages need not know about the launcher: it looks at what is underneath it after scrolling, resizing and page
 * changes. Returns the lift in pixels (0 when nothing is underneath).
 */
export function useAvoidBottomBars(ref: RefObject<HTMLElement | null>, active: boolean): number {
  const [lift, setLift] = useState(0);
  const liftRef = useRef(0);

  useEffect(() => {
    if (!active || typeof document.elementsFromPoint !== 'function') {
      return undefined;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const element = ref.current;
      if (!element) return;
      const next = bottomBarLift(element, liftRef.current);
      if (next !== liftRef.current) {
        liftRef.current = next;
        setLift(next);
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    // Bars appear without a scroll (the flight compare tray): watch the page, but not the assistant's own updates.
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver((records) => {
      if (records.some((record) => !(record.target instanceof Element && record.target.closest('[data-assistant-root]')))) {
        schedule();
      }
    });
    observer?.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, active]);

  return active ? lift : 0;
}

/**
 * How far `launcher` must move up so that no bottom bar is underneath it. `currentLift` is the lift applied now (the
 * measurement is made at the launcher's resting place).
 */
export function bottomBarLift(launcher: HTMLElement, currentLift: number): number {
  const rect = launcher.getBoundingClientRect();
  const top = rect.top + currentLift;
  const bottom = rect.bottom + currentLift;
  const xs = [rect.left + 4, (rect.left + rect.right) / 2, rect.right - 4];
  const ys = [top + 4, (top + bottom) / 2, bottom - 4];
  const viewport = window.innerHeight;
  let lift = 0;
  for (const x of xs) {
    for (const y of ys) {
      for (const hit of document.elementsFromPoint(x, y)) {
        const bar = bottomBarOf(hit, launcher, viewport);
        if (bar) {
          lift = Math.max(lift, bottom - bar.getBoundingClientRect().top + GAP);
        }
      }
    }
  }
  return Math.round(Math.min(Math.max(lift, 0), viewport * 0.4));
}

/**
 * The element `hit` belongs to that the launcher must stay above: a control marked `data-assistant-avoid`, or a fixed
 * or bottom-sticky bar in the lower half of the screen.
 */
function bottomBarOf(hit: Element, launcher: HTMLElement, viewport: number): Element | null {
  if (launcher.contains(hit) || hit.closest('[data-assistant-root]')) {
    return null;
  }
  const marked = hit.closest('[data-assistant-avoid]');
  if (marked) {
    // Below the upper quarter only: moving far up would cover more than it frees.
    return marked.getBoundingClientRect().top > viewport / 4 ? marked : null;
  }
  for (let node: Element | null = hit; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    const stuck = style.position === 'fixed' || (style.position === 'sticky' && style.bottom !== 'auto');
    if (stuck) {
      // Overlays, drawers, sidebars and dropdowns from the top are not bottom bars.
      return node.getBoundingClientRect().top > viewport / 2 ? node : null;
    }
  }
  return null;
}
