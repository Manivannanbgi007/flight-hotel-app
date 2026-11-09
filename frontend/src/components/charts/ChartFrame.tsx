import { useId, useState, type ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';

import { tableStyles } from '@/components/ui/dataTableStyles';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { useElementWidth } from './useElementWidth';

export interface LegendEntry {
  label: string;
  color: string;
  /** Mirrors the mark: a short line for line charts, a square for bars, areas and slices. */
  shape: 'line' | 'square';
}

export interface ChartTable {
  /** Header of the first column ("Date") and of each value column. */
  columns: string[];
  /** One row per category: the category, then the formatted values. */
  rows: string[][];
}

/**
 * What every kit chart shares (the recharts part is lazy-loaded inside it): the legend for two or more series, the
 * plot as an image with a one-sentence summary for screen readers, the same numbers as a table (hidden until "Show as
 * table", always read by screen readers), and the loading and empty states.
 */
export function ChartFrame({ title, summary, legend, table, height, loading, empty, emptyMessage, className, children }: {
  title: string;
  summary: string;
  legend: LegendEntry[];
  table: ChartTable;
  height: number;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  className?: string;
  /** The plot, given the measured width. */
  children: (width: number) => ReactNode;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>(640);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  return (
    <figure className={cn('flex min-w-0 flex-col gap-3', className)}>
      {legend.length > 1 && !loading && !empty && (
        <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-medium text-slate-600">
          {legend.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn('inline-block shrink-0', entry.shape === 'line' ? 'h-0.5 w-3.5 rounded-full' : 'size-2.5 rounded-[3px]')}
                style={{ background: entry.color }}
              />
              {entry.label}
            </li>
          ))}
        </ul>
      )}

      <div ref={ref} className="relative w-full min-w-0" style={{ height }}>
        {loading ? (
          <>
            <span role="status" className="sr-only">Loading {title}…</span>
            <Skeleton className="size-full rounded-xl" />
          </>
        ) : empty ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 text-center">
            <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-white text-slate-400 shadow-xs ring-1 ring-slate-200">
              <BarChart3 className="size-5" />
            </span>
            <p className="text-sm font-semibold text-slate-700">{emptyMessage ?? 'No data for this period'}</p>
            <p className="sr-only">{summary}</p>
          </div>
        ) : (
          <div role="img" aria-label={summary} className="size-full">
            {children(width)}
          </div>
        )}
      </div>

      {!loading && !empty && (
        <>
          <figcaption className="flex justify-end text-xs">
            <button
              type="button"
              className="rounded-md font-semibold text-brand-700 hover:underline"
              aria-expanded={showTable}
              aria-controls={tableId}
              onClick={() => setShowTable((value) => !value)}
            >
              {showTable ? 'Hide table' : 'Show as table'}
            </button>
          </figcaption>
          <div id={tableId} className={showTable ? 'relative max-h-72 overflow-auto rounded-xl border border-slate-200' : 'sr-only'}>
            <table className="min-w-full text-left text-xs">
              <caption className="sr-only">{title}</caption>
              <thead className="sticky top-0">
                <tr>
                  {table.columns.map((column, index) => (
                    <th key={column} scope="col" className={cn(tableStyles.thCompact, index > 0 && 'text-right')}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {table.rows.map((row, rowIndex) => (
                  <tr key={`${row[0]}-${rowIndex}`}>
                    {row.map((cell, index) => (index === 0
                      ? <th key={index} scope="row" className="px-3 py-1.5 font-normal text-slate-700">{cell}</th>
                      : <td key={index} className="px-3 py-1.5 text-right tabular-nums text-slate-900">{cell}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </figure>
  );
}

/** A card around a chart: title (h2/h3), description, actions (interval picker, download) on the right. */
export function ChartCard({ title, description, actions, as: Heading = 'h2', className, children }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Heading className="text-base font-bold tracking-tight text-slate-900">{title}</Heading>
          {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
