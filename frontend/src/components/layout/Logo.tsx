import { Plane } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * The brand mark: a gradient tile with a plane, and the site name (from the site settings). `tone="light"` for dark
 * backgrounds. The name is the accessible text, so a link around the logo is called by the site name.
 */
export function Logo({ name, tone = 'dark', className, tileClassName }: {
  name: string;
  tone?: 'dark' | 'light';
  className?: string;
  /** Override the tile colours (the staff portals use their role gradient). */
  tileClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-white shadow-glow ring-1 ring-inset ring-white/25',
          tileClassName,
        )}
      >
        <Plane className="size-5 -rotate-12" />
      </span>
      <span className={cn('text-lg font-extrabold tracking-tight', tone === 'dark' ? 'text-slate-900' : 'text-white')}>{name}</span>
    </span>
  );
}
