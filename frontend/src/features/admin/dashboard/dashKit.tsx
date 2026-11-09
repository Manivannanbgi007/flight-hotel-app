import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';

import { Reveal } from '@/components/motion/Reveal';
import { TrendChip } from '@/components/ui/StatCard';
import { cn } from '@/lib/cn';
import { useCan } from '../shared/permissions';
import type { Permission } from '@/lib/auth/types';
import { countTrend } from './dashHelpers';

/**
 * Building blocks shared by the admin dashboard's sections: one card look (accent colour, icon tile, title, "View
 * all"), the trend chip for lists, the chart settings of the range the server answered with, and small avatars.
 * Colours mean the same everywhere: blue = hotels, flights and information, green = successful bookings and money
 * collected, orange = pending, red = cancellations and failures, indigo = analytics.
 */

export type Accent = 'blue' | 'green' | 'orange' | 'red' | 'purple';

const ACCENTS: Record<Accent, { tile: string; bar: string; glow: string }> = {
  blue: { tile: 'from-brand-500 to-info-500', bar: 'from-brand-500 via-info-500 to-info-200', glow: 'bg-info-100/50' },
  green: { tile: 'from-success-500 to-success-600', bar: 'from-success-500 via-success-200 to-success-100', glow: 'bg-success-100/50' },
  orange: { tile: 'from-warning-500 to-accent-500', bar: 'from-warning-500 via-accent-400 to-warning-200', glow: 'bg-warning-100/50' },
  red: { tile: 'from-danger-500 to-danger-600', bar: 'from-danger-500 via-danger-200 to-danger-100', glow: 'bg-danger-100/50' },
  purple: { tile: 'from-role-500 to-role-700', bar: 'from-role-500 via-role-400 to-role-200', glow: 'bg-role-100/50' },
};

/** A dashboard section: a card with an accent bar, a gradient icon tile, a title and an optional "View all". */
export function DashSection({ id, title, description, icon, accent = 'purple', action, className, children }: {
  id: string;
  title: string;
  description?: ReactNode;
  icon: ReactNode;
  accent?: Accent;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const style = ACCENTS[accent];
  return (
    <Reveal>
      <section
        id={id}
        aria-labelledby={`${id}-title`}
        className={cn('group/section relative isolate flex min-w-0 flex-col gap-5 overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6', className)}
      >
        <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', style.bar)} />
        <span aria-hidden="true" className={cn('pointer-events-none absolute -right-16 -top-20 -z-10 size-56 rounded-full blur-3xl', style.glow)} />
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3.5">
            <span aria-hidden="true" className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md ring-1 ring-inset ring-white/20 [&>svg]:size-5', style.tile)}>
              {icon}
            </span>
            <div className="min-w-0">
              <h2 id={`${id}-title`} className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
              {description && <p className="text-sm text-slate-600">{description}</p>}
            </div>
          </div>
          {action}
        </header>
        {children}
      </section>
    </Reveal>
  );
}

/** "View all →" for a section, shown only when the admin may open the page it leads to. */
export function ViewAll({ to, label, permission }: { to: string; label: string; permission?: Permission }) {
  const allowed = useCan(permission ?? 'REPORT_VIEW');
  if (!allowed) return null;
  return (
    <Link
      to={to}
      className="group inline-flex items-center gap-1.5 rounded-full bg-role-50 px-3.5 py-1.5 text-sm font-semibold text-role-700 ring-1 ring-inset ring-role-100 transition-colors duration-(--duration-fast) hover:bg-role-100"
    >
      {label}
      <ArrowRight className="size-4 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

export function Trend({ current, previous }: { current: number; previous: number }) {
  return <TrendChip change={countTrend(current, previous)} />;
}

const AVATAR_TONES = [
  'bg-brand-100 text-brand-700', 'bg-success-100 text-success-700', 'bg-warning-100 text-warning-700',
  'bg-role-100 text-role-700', 'bg-info-100 text-info-700', 'bg-accent-100 text-accent-700',
];

/** Initials of a name (or of the e-mail's local part) on a soft colour that stays the same for the same person. */
export function Initials({ name, email, className }: { name?: string | null; email?: string | null; className?: string }) {
  const source = (name?.trim() || email?.split('@')[0] || '?').trim();
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters = ((words[0]?.[0] ?? '?') + (words.length > 1 ? words[words.length - 1]![0]! : '')).toUpperCase();
  let hash = 0;
  for (const char of source) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden="true" className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-2 ring-white', AVATAR_TONES[hash % AVATAR_TONES.length], className)}>
      {letters}
    </span>
  );
}

/** A thin bar showing `percent` of the full width (decorative: the number is always written next to it). */
export function ShareBar({ percent, className, barClassName, color }: { percent: number; className?: string; barClassName?: string; color?: string }) {
  return (
    <span aria-hidden="true" className={cn('block h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <span className={cn('block h-full rounded-full bg-gradient-to-r from-brand-500 to-info-500 transition-[width] duration-700 ease-out-soft', barClassName)} style={{ width: `${Math.min(100, Math.max(0, percent))}%`, ...(color ? { backgroundImage: 'none', backgroundColor: color } : {}) }} />
    </span>
  );
}
