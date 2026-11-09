import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { cn } from '@/lib/cn';
import { Skeleton } from './Skeleton';

export interface StatChange {
  /** Change against the previous period in percent (12.5 = +12.5 %); null when there is nothing to compare with. */
  percent: number | null;
  /** What it is compared with: "vs last month". */
  period?: string;
  /** Is a rise good news? (bookings: yes; cancellations, refunds: no). Default true. */
  upIsGood?: boolean;
  /** Neither direction is good or bad (a customer's own spending): the chip stays grey. */
  neutral?: boolean;
  /** With `percent: null`: the figure is new (nothing in the previous period), shown as a "New" chip. */
  isNew?: boolean;
  /**
   * 'percent' (default): `percent` is a relative change, shown "12.5%". 'points': `percent` is the change of a rate in
   * percentage points, shown "+2.1 pp" (screen readers: "Up 2.1 percentage points").
   */
  unit?: 'percent' | 'points';
}

const percentFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const pointsFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** The trend chip: arrow + percentage; colour says good or bad, the words say up or down. */
export function TrendChip({ change }: { change: StatChange }) {
  const { percent, period, upIsGood = true, neutral = false, isNew = false, unit = 'percent' } = change;
  if ((percent === null || !Number.isFinite(percent)) && isNew) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
        <span className="inline-flex items-center rounded-full bg-brand-50 px-1.5 py-0.5 font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
          New<span className="sr-only">: nothing in the previous period</span>
        </span>
        {period && <span className="text-slate-500">{period}</span>}
      </span>
    );
  }
  if (percent === null || !Number.isFinite(percent)) {
    return <span className="text-xs text-slate-500">No earlier figures to compare{period ? ` ${period}` : ''}</span>;
  }
  const direction = percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat';
  const good = direction === 'flat' || neutral ? null : (direction === 'up') === upIsGood;
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const words = direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'No change,';
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold',
          good === null ? 'bg-slate-100 text-slate-700' : good ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700',
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {unit === 'points' ? (
          <>
            <span aria-hidden="true">{percent > 0 ? '+' : percent < 0 ? '−' : ''}{pointsFormat.format(Math.abs(percent))} pp</span>
            <span className="sr-only">{words} {pointsFormat.format(Math.abs(percent))} percentage points</span>
          </>
        ) : (
          <>
            <span className="sr-only">{words} </span>
            {percentFormat.format(Math.abs(percent))}%
          </>
        )}
      </span>
      {period && <span className="text-slate-500">{period}</span>}
    </span>
  );
}

/**
 * KPI card: label, value (counts up when it is a number), optional change against the previous period, icon and a
 * sparkline slot (`<Sparkline values={...} />`). Values always come from the API, never from the code.
 */
export function StatCard({ label, value, format, change, icon, sparkline, footer, to, loading = false, className }: {
  label: string;
  /** A number (animated, formatted with `format`) or any node (e.g. "₹2,00,000" already formatted). */
  value: number | ReactNode;
  format?: (value: number) => string;
  change?: StatChange;
  icon?: ReactNode;
  sparkline?: ReactNode;
  footer?: ReactNode;
  /** Makes the whole card a link to the details. */
  to?: string;
  loading?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-600">{label}</p>
        {icon && (
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-role-50 text-role-600 ring-1 ring-role-100">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {loading ? (
            <>
              <span role="status" className="sr-only">Loading {label}…</span>
              <Skeleton className="h-9 w-28" />
            </>
          ) : (
            <p className="truncate text-3xl font-bold tracking-tight text-slate-900">
              {typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value}
            </p>
          )}
          {change && !loading && <div className="mt-2"><TrendChip change={change} /></div>}
        </div>
        {sparkline && !loading && <div className="shrink-0">{sparkline}</div>}
      </div>
      {footer && <div className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">{footer}</div>}
    </>
  );
  const surface = cn('relative block rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card', className);
  return to ? (
    <Link to={to} className={cn(surface, 'hover-lift hover:border-role-200')}>{body}</Link>
  ) : (
    <div className={surface}>{body}</div>
  );
}
