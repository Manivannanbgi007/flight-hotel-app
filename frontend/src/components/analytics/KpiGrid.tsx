import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

const columnClasses = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 xl:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
} as const;

/**
 * A row of KPI cards as a list (screen readers hear how many figures there are; tests find a card by its label).
 * Put one `<StatCard>` in each `<KpiItem>`.
 */
export function KpiGrid({ label, columns = 4, className, children }: {
  /** Accessible name of the list ("Revenue figures"). */
  label: string;
  columns?: keyof typeof columnClasses;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul aria-label={label} className={cn('grid gap-4', columnClasses[columns], className)}>
      {children}
    </ul>
  );
}

export function KpiItem({ className, children }: { className?: string; children: ReactNode }) {
  return <li className={cn('min-w-0 [&>*]:h-full', className)}>{children}</li>;
}

/**
 * Small label/value pairs under a section (booking statuses, today's guests): a compact `<dl>` strip, for figures that
 * need no chart or chip.
 */
export function FigureStrip({ items, className }: {
  items: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5', className)}>
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-xs">
          <dt className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            {item.icon && <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-md bg-role-50 text-role-600">{item.icon}</span>}
            <span className="min-w-0 truncate">{item.label}</span>
          </dt>
          <dd className="mt-1 text-xl font-bold tracking-tight text-slate-900">{item.value}</dd>
          {item.hint && <dd className="text-xs text-slate-500">{item.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
