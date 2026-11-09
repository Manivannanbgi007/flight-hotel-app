import { useId, type ReactNode } from 'react';

import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { Skeleton } from '@/components/ui/Skeleton';
import { TrendChip, type StatChange } from '@/components/ui/StatCard';
import { cn } from '@/lib/cn';

/**
 * The headline band of a dashboard: the portal's accent as a deep gradient with white figures (white on role-700 and
 * darker passes AA). Decorative rings only; every figure is text. `title` is the section's h2 (or h3).
 */
export function HighlightPanel({ title, description, actions, as: Heading = 'h2', aside, children, className }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
  /** Right column (a sparkline, an illustration); hidden from small phones when it is decoration. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'relative isolate overflow-hidden rounded-3xl p-5 text-white shadow-lg sm:p-6',
        'bg-[linear-gradient(135deg,var(--role-700)_0%,var(--role-900)_60%,var(--role-950)_100%)]',
        className,
      )}
    >
      {/* Soft glows as gradients (no blur filter: cheaper to paint on every scroll). */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 -z-10 size-80 rounded-full bg-[radial-gradient(circle,rgb(255_255_255/0.16)_0%,transparent_65%)]" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-28 left-1/4 -z-10 size-72 rounded-full bg-[radial-gradient(circle,rgb(255_255_255/0.08)_0%,transparent_65%)]" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Heading id={headingId} className="text-sm font-bold uppercase tracking-wider text-white/90">{title}</Heading>
          {description && <p className="mt-0.5 text-sm text-white/85">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0 flex-1">{children}</div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
    </section>
  );
}

/** One white figure in a HighlightPanel: label, value (counts up), optional change chip and note. */
export function HighlightFigure({ label, value, format, change, note, size = 'md', loading = false }: {
  label: string;
  value: number | ReactNode;
  format?: (value: number) => string;
  change?: StatChange;
  note?: ReactNode;
  /** `lg` for the one figure the panel is about. */
  size?: 'md' | 'lg';
  loading?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-white/90">{label}</p>
      {loading ? (
        <>
          <span role="status" className="sr-only">Loading {label}…</span>
          <Skeleton className={cn('mt-1 bg-white/20', size === 'lg' ? 'h-11 w-48' : 'h-8 w-32')} />
        </>
      ) : (
        <p className={cn('mt-1 font-bold tracking-tight', size === 'lg' ? 'text-4xl sm:text-5xl' : 'text-2xl sm:text-3xl')}>
          {typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value}
        </p>
      )}
      {change && !loading && <div className="mt-2"><TrendChip change={{ ...change, period: undefined }} /></div>}
      {note && !loading && <p className="mt-1.5 text-xs text-white/85">{note}</p>}
    </div>
  );
}
