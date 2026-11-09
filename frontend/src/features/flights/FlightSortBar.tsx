import { useId } from 'react';
import { PlaneLanding, PlaneTakeoff, Timer, Wallet, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';
import { SORT_LABELS, type FlightSort } from './types';

const SORTS = Object.keys(SORT_LABELS) as FlightSort[];

const ICONS: Record<FlightSort, LucideIcon> = {
  PRICE_ASC: Wallet,
  DURATION_ASC: Timer,
  DEPARTURE_ASC: PlaneTakeoff,
  ARRIVAL_ASC: PlaneLanding,
};

/**
 * The sort order as four tiles (real radio buttons): each shows the best value for its order among the flights on
 * screen ("Lowest price ₹18,482", "Shortest journey 2h 9m"), so the tiles answer the question before a click. The
 * chosen tile gets a filled icon and a line that draws itself.
 */
export function FlightSortBar({ value, summaries, onChange, className }: {
  value: FlightSort;
  summaries: Record<FlightSort, string> | null;
  onChange: (sort: FlightSort) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="sr-only">Sort by</legend>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
        {SORTS.map((sort) => {
          const checked = value === sort;
          const Icon = ICONS[sort];
          const valueId = `${id}-${sort}`;
          return (
            <label
              key={sort}
              className={cn(
                'relative flex min-w-0 cursor-pointer items-center gap-2.5 overflow-hidden rounded-2xl px-3 py-2.5 ring-1 ring-inset sm:gap-3 sm:px-3.5 sm:py-3',
                'transition-[background-color,box-shadow] duration-(--duration-base) ease-out-soft',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
                checked ? 'bg-white shadow-md ring-brand-300' : 'bg-white/70 ring-slate-200 hover:bg-white hover:shadow-sm',
              )}
            >
              <input
                type="radio"
                name={id}
                className="sr-only"
                checked={checked}
                onChange={() => onChange(sort)}
                aria-label={SORT_LABELS[sort]}
                aria-describedby={summaries ? valueId : undefined}
              />
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-(--duration-base)',
                  checked ? 'bg-brand-600 text-white shadow-glow' : 'bg-slate-100 text-slate-500',
                )}
              >
                <Icon className="size-[1.125rem] text-current" />
              </span>
              <span className="min-w-0">
                <span className={cn('block text-xs font-semibold leading-tight', checked ? 'text-brand-700' : 'text-slate-600')}>
                  {SORT_LABELS[sort]}
                </span>
                <span id={valueId} className="mt-0.5 block truncate text-base font-bold tabular-nums tracking-tight text-slate-900">
                  {summaries?.[sort] ?? '–'}
                </span>
              </span>
              {checked && (
                <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-[3px] origin-left rounded-t-full bg-brand-600 animate-draw-x" />
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
