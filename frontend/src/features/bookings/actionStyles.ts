import { cn } from '@/lib/cn';

/**
 * A link that starts a destructive flow ("Cancel booking"): outlined in the danger colour, the size of a button.
 * Not `buttonClass({ variant })` because `cn` does not merge conflicting colour classes.
 */
export function dangerLinkClass(size: 'sm' | 'md' = 'sm'): string {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap border border-danger-200 bg-white font-semibold text-danger-700 shadow-xs',
    'transition-[background-color,border-color,box-shadow] duration-(--duration-fast) ease-out-soft hover:border-danger-500 hover:bg-danger-50 active:translate-y-px',
    size === 'sm' ? 'h-8 rounded-lg px-3 text-sm' : 'h-10 rounded-xl px-4 text-sm',
  );
}
