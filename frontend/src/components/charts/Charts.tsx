import { lazy, Suspense } from 'react';

import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { ChartFrame } from './ChartFrame';
import { cartesianModel, donutModel } from './chartModel';
import type { AreaChartProps, BarChartProps, CartesianChartProps, DonutChartProps } from './types';

// recharts is only downloaded when the first chart is drawn.
const CartesianPlot = lazy(() => import('./impl/rechartsPlots').then((module) => ({ default: module.CartesianPlot })));
const DonutPlot = lazy(() => import('./impl/rechartsPlots').then((module) => ({ default: module.DonutPlot })));

const DEFAULT_HEIGHT = 260;

function PlotFallback() {
  return <Skeleton className="size-full rounded-xl" />;
}

function Cartesian({ kind, stacked, ...props }: CartesianChartProps & { kind: 'line' | 'area' | 'bar'; stacked?: boolean }) {
  const { title, data, xKey, height = DEFAULT_HEIGHT, loading, emptyMessage, className, valueFormat } = props;
  const animate = !useReducedMotion();
  const model = cartesianModel(props);
  return (
    <ChartFrame
      title={title}
      summary={model.summary}
      legend={model.series.map((s) => ({ label: s.label, color: s.color, shape: kind === 'line' ? 'line' : 'square' }))}
      table={model.table}
      height={height}
      loading={loading}
      empty={model.empty}
      emptyMessage={emptyMessage}
      className={className}
    >
      {(width) => (
        <Suspense fallback={<PlotFallback />}>
          <CartesianPlot
            kind={kind}
            width={width}
            height={height}
            data={data}
            xKey={xKey}
            series={model.series}
            stacked={stacked}
            formatValue={model.formatValue}
            formatTick={model.formatTick}
            formatX={model.formatX}
            integer={model.integer}
            yAxisWidth={valueFormat === 'inr' || valueFormat === 'inr-compact' ? 64 : 48}
            animate={animate}
          />
        </Suspense>
      )}
    </ChartFrame>
  );
}

/** Values over time, one line per series (revenue per day, bookings per month). */
export function LineChart(props: CartesianChartProps) {
  return <Cartesian kind="line" {...props} />;
}

/** Like LineChart with a soft wash under each line; `stacked` for parts of a total over time. */
export function AreaChart({ stacked, ...props }: AreaChartProps) {
  return <Cartesian kind="area" stacked={stacked} {...props} />;
}

/** Columns per category: side by side (grouped, default) or `stacked` (parts of one total). */
export function BarChart({ stacked, ...props }: BarChartProps) {
  return <Cartesian kind="bar" stacked={stacked} {...props} />;
}

/** Part of a whole with few parts (≤ 5): a ring with the total (or `centerValue`) in the middle. */
export function DonutChart({ title, data, valueFormat, height = 220, loading, emptyMessage, centerLabel, centerValue, className }: DonutChartProps) {
  const animate = !useReducedMotion();
  const model = donutModel({ title, data, valueFormat });
  return (
    <ChartFrame
      title={title}
      summary={model.summary}
      legend={model.slices.map((slice) => ({ label: slice.label, color: slice.color, shape: 'square' }))}
      table={model.table}
      height={height}
      loading={loading}
      empty={model.empty}
      emptyMessage={emptyMessage}
      className={className}
    >
      {(width) => (
        <>
          <Suspense fallback={<PlotFallback />}>
            <DonutPlot width={width} height={height} slices={model.slices} formatValue={model.formatValue} animate={animate} />
          </Suspense>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xl font-bold tracking-tight text-slate-900">{centerValue ?? model.formatValue(model.total)}</span>
            {centerLabel && <span className="text-xs font-medium text-slate-500">{centerLabel}</span>}
          </div>
        </>
      )}
    </ChartFrame>
  );
}
