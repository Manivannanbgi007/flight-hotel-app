import { chartSummary } from '@/components/ui/chartMath';
import { formatDateCategory, resolveValueFormat, type DateFormat, type ValueFormat } from './format';
import { seriesColor } from './palette';
import type { ChartSeriesDef, Datum, DonutSlice } from './types';

/** A row value as a number (missing or not a number → 0). */
export function valueOf(row: Datum, key: string): number {
  const value = Number(row[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/** Everything a cartesian chart shows besides the plot: colours, legend, summary, table and whether it is empty. */
export function cartesianModel({ title, data, xKey, series, valueFormat, xFormat = 'none', xLabel }: {
  title: string;
  data: Datum[];
  xKey: string;
  series: ChartSeriesDef[];
  valueFormat?: ValueFormat;
  xFormat?: DateFormat;
  xLabel?: string;
}) {
  const { full, tick } = resolveValueFormat(valueFormat);
  const formatX = (value: string) => formatDateCategory(value, xFormat);
  const colored = series.map((s, index) => ({ key: s.key, label: s.label, color: seriesColor(index, s.color), level: s.level }));
  const categories = data.map((row) => formatX(String(row[xKey] ?? '')));
  const values = colored.map((s) => ({ label: s.label, level: s.level, values: data.map((row) => valueOf(row, s.key)) }));
  const empty = data.length === 0 || values.every((s) => s.values.every((value) => value === 0));
  const isDate = typeof xFormat === 'string' && xFormat !== 'none';
  return {
    series: colored,
    formatValue: full,
    formatTick: tick,
    formatX,
    empty,
    summary: empty ? `${title}: no data.` : chartSummary(title, categories, values, full),
    table: {
      columns: [xLabel ?? (isDate ? 'Date' : 'Category'), ...colored.map((s) => s.label)],
      rows: categories.map((category, index) => [category, ...values.map((s) => full(s.values[index] ?? 0))]),
    },
    integer: valueFormat === 'count',
  };
}

/** The same for a donut: slices with colours and shares. */
export function donutModel({ title, data, valueFormat }: { title: string; data: DonutSlice[]; valueFormat?: ValueFormat }) {
  const { full } = resolveValueFormat(valueFormat);
  const slices = data.map((slice, index) => ({ label: slice.label, value: Math.max(0, slice.value), color: seriesColor(index, slice.color) }));
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const share = (value: number) => (total > 0 ? `${Math.round((value / total) * 1000) / 10}%` : '0%');
  const empty = total === 0;
  return {
    slices,
    total,
    formatValue: full,
    empty,
    summary: empty
      ? `${title}: no data.`
      : `${title}, ${full(total)} in total. ${slices.map((slice) => `${slice.label}: ${full(slice.value)} (${share(slice.value)})`).join('. ')}.`,
    table: {
      columns: ['Part', 'Value', 'Share'],
      rows: slices.map((slice) => [slice.label, full(slice.value), share(slice.value)]),
    },
  };
}
