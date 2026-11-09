/**
 * Chart kit (DESIGN_SYSTEM.md "Chart kit"): recharts-based charts that load recharts only when a chart is drawn.
 *
 *   import { BarChart, ChartCard } from '@/components/charts';
 *   <ChartCard title="Bookings per day" description="Last 30 days">
 *     <BarChart title="Bookings per day" data={rows} xKey="date" xFormat="DAY" valueFormat="count" stacked
 *       series={[{ key: 'hotel', label: 'Hotels' }, { key: 'flight', label: 'Flights' }]} loading={query.isPending} />
 *   </ChartCard>
 */
export { AreaChart, BarChart, DonutChart, LineChart } from './Charts';
export { ChartCard } from './ChartFrame';
export { Sparkline } from './Sparkline';
export {
  formatCompact,
  formatCount,
  formatDateCategory,
  formatINR,
  formatINRCompact,
  formatNumber,
  formatPercent,
  resolveValueFormat,
  type DateFormat,
  type ValueFormat,
} from './format';
export { CHART_SERIES_COLORS, seriesColor } from './palette';
export type { AreaChartProps, BarChartProps, CartesianChartProps, ChartSeriesDef, Datum, DonutChartProps, DonutSlice } from './types';
