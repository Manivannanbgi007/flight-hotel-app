import type { DateFormat, ValueFormat } from './format';

/** One row of chart data: the category (`xKey`) and a value per series key. Missing values count as 0. */
export type Datum = Record<string, string | number | null | undefined>;

export interface ChartSeriesDef {
  /** The field of each row that holds this series' value. */
  key: string;
  /** "Hotel bookings" (legend, tooltip, table header). */
  label: string;
  /** Only to keep a series' colour fixed across charts; default: its slot in the validated order. */
  color?: string;
  /** The values are a level over time (customers registered so far), so summaries never add them up. */
  level?: boolean;
}

interface ChartBaseProps {
  /** What is plotted ("Revenue per day"): the screen-reader summary and the table caption. */
  title: string;
  /** Full values (tooltip, table, summary) and axis ticks: 'inr' → ₹2,00,000 / ₹2L. Default: plain numbers. */
  valueFormat?: ValueFormat;
  /** Plot height in px (the legend and the table toggle come on top). Default 260. */
  height?: number;
  /** Shows the shimmer placeholder instead of the plot. */
  loading?: boolean;
  /** Text when there is nothing to plot. */
  emptyMessage?: string;
  className?: string;
}

export interface CartesianChartProps extends ChartBaseProps {
  data: Datum[];
  /** The category field (usually a date "2026-10-07"). */
  xKey: string;
  series: ChartSeriesDef[];
  /** How categories read: 'day' → "7 Oct", 'month' → "Oct 2026", or the API's DAY/WEEK/MONTH/YEAR. */
  xFormat?: DateFormat;
  /** Header of the first table column. Default "Date" when xFormat is a date format, else "Category". */
  xLabel?: string;
}

export interface BarChartProps extends CartesianChartProps {
  /** Series stacked in one column per category (part of a whole) instead of side by side. */
  stacked?: boolean;
}

export interface AreaChartProps extends CartesianChartProps {
  stacked?: boolean;
}

export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps extends ChartBaseProps {
  data: DonutSlice[];
  /** Small text in the hole, e.g. "Cancelled". */
  centerLabel?: string;
  /** Big text in the hole; default: the total in valueFormat. */
  centerValue?: string;
}
