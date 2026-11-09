import { format, parseISO } from 'date-fns';
import type { ReactNode } from 'react';

import { useElementWidth } from '@/components/charts/useElementWidth';
import { formatDate } from '@/lib/format';

export interface NightBar {
  /** `YYYY-MM-DD` */
  date: string;
  value: number;
  /** The value as text, e.g. "62%" or "₹12,400". */
  label: string;
}

const PLOT_HEIGHT = 220;
const MARGIN = { top: 22, right: 12, bottom: 28, left: 56 };
/** Below 4 px per night the chart scrolls sideways (the table below always has every night). */
const MIN_SLOT = 4;
const MAX_BAR = 36;
/** One date label per ~72 px, so they never collide. */
const LABEL_SPACING = 72;

/** Rounded data end (4px), square at the baseline. */
function barPath(x: number, top: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  const bottom = top + height;
  return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${bottom}Z`;
}

/** Friday and Saturday nights: the hotel's weekend. */
const isWeekendNight = (date: string) => [5, 6].includes(parseISO(date).getDay());

/**
 * One bar per night (a single series: the title names it, so there is no legend for it), as wide as its card. Bars are
 * at most 36 px wide, weekend nights (Friday, Saturday) sit on a shaded band, hairline gridlines, a few date labels, and
 * an optional dashed reference line (the period's overall figure). Hovering a night shows its value; screen readers get
 * `summary` and the table that goes with the chart.
 */
export function NightlyBarChart({ title, description, bars, max, ticks, formatTick, summary, reference }: {
  title: string;
  description?: ReactNode;
  bars: NightBar[];
  /** Top of the value axis. */
  max: number;
  ticks: number[];
  formatTick: (value: number) => string;
  summary: string;
  /** A dashed line across the plot, e.g. the overall occupancy of the period. */
  reference?: { value: number; label: string };
}) {
  const { ref, width: available } = useElementWidth<HTMLDivElement>(760);
  const count = Math.max(bars.length, 1);
  const plotWidth = Math.max(available - MARGIN.left - MARGIN.right, count * MIN_SLOT);
  const slot = plotWidth / count;
  const barWidth = Math.max(1, Math.min(MAX_BAR, slot * 0.7, slot - 2));
  const width = MARGIN.left + plotWidth + MARGIN.right;
  const height = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom;
  const baseline = MARGIN.top + PLOT_HEIGHT;
  const y = (value: number) => baseline - (max > 0 ? (Math.min(value, max) / max) * PLOT_HEIGHT : 0);
  const labelEvery = Math.max(1, Math.ceil(bars.length / Math.max(2, Math.floor(plotWidth / LABEL_SPACING))));
  const weekends = bars.some((bar) => isWeekendNight(bar.date));

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <span className="min-w-0">
          <span className="block text-base font-semibold text-slate-900">{title}</span>
          {description && <span className="mt-0.5 block text-sm text-slate-500">{description}</span>}
        </span>
        <span aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {weekends && <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm bg-slate-100 ring-1 ring-inset ring-slate-200" />Weekend nights</span>}
          {reference && reference.value > 0 && (
            <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-accent-500" />{reference.label}</span>
          )}
        </span>
      </figcaption>
      <div ref={ref} className="relative overflow-x-auto">
        <svg role="img" aria-label={summary} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
          {bars.map((bar, index) => isWeekendNight(bar.date) && (
            <rect key={`w-${bar.date}`} x={MARGIN.left + index * slot} y={MARGIN.top} width={slot} height={PLOT_HEIGHT} className="fill-slate-100/70" />
          ))}
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)}
                className={tick === 0 ? 'stroke-slate-300' : 'stroke-slate-200'} strokeWidth={1} strokeDasharray={tick === 0 ? undefined : '3 4'} />
              <text x={MARGIN.left - 10} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[11px] tabular-nums">
                {formatTick(tick)}
              </text>
            </g>
          ))}
          {bars.map((bar, index) => {
            const slotX = MARGIN.left + index * slot;
            const x = slotX + (slot - barWidth) / 2;
            const top = y(bar.value);
            const barHeight = baseline - top;
            return (
              <g key={bar.date} className="group">
                <title>{`${formatDate(bar.date)}: ${bar.label}`}</title>
                {/* The whole slot answers to the pointer, not only the (thin) bar. */}
                <rect x={slotX} y={MARGIN.top} width={slot} height={PLOT_HEIGHT} fill="transparent" />
                {barHeight > 0 && (
                  <path d={barPath(x, top, barWidth, barHeight)} className="fill-role-500 transition-colors duration-150 group-hover:fill-role-700" />
                )}
                <text x={x + barWidth / 2} y={top - 6} textAnchor="middle"
                  className="pointer-events-none fill-slate-900 text-[11px] font-semibold opacity-0 transition-opacity group-hover:opacity-100">
                  {bar.label}
                </text>
                {index % labelEvery === 0 && (
                  <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">
                    {format(parseISO(bar.date), 'd MMM')}
                  </text>
                )}
              </g>
            );
          })}
          {reference && reference.value > 0 && (
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(reference.value)} y2={y(reference.value)}
              className="stroke-accent-500" strokeWidth={1.5} strokeDasharray="6 4" />
          )}
        </svg>
      </div>
    </figure>
  );
}
