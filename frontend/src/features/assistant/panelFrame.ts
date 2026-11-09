import { cn } from '@/lib/cn';

/** The panel's id (the launcher's `aria-controls`). */
export const ASSISTANT_PANEL_ID = 'assistant-panel';

/** Normal: docked in the bottom-right corner. Maximized: the whole window, with a margin. (Minimized = closed.) */
export type PanelSize = 'normal' | 'maximized';

/**
 * Where the panel sits. Phones: always a full-screen sheet. From `sm` up:
 * - normal: a card docked above the launcher, 39rem (624 px: 25 % wider than the 31.25rem of the previous design, which
 *   was itself 25 % wider than the first 25rem one) and up to 40rem tall, never wider or taller than the window allows;
 * - maximized: every side 1rem (1.5rem from `lg`) from the window's edge, the full height of the window.
 * Shared by the panel and its loading placeholder, so nothing jumps when the code arrives.
 */
export function panelFrameClass(size: PanelSize): string {
  return cn(
    'fixed inset-0 z-50 flex flex-col overflow-hidden bg-white',
    'sm:rounded-3xl sm:shadow-2xl sm:ring-1 sm:ring-slate-900/10',
    size === 'maximized'
      ? 'sm:inset-4 lg:inset-6'
      : 'sm:inset-auto sm:bottom-24 sm:right-6 sm:z-40 sm:h-[min(40rem,calc(100dvh-7.5rem))] sm:w-[min(39rem,calc(100vw-3rem))]',
  );
}
