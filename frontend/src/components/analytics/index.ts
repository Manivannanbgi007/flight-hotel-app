/**
 * Analytics building blocks of the staff dashboards (DESIGN_SYSTEM.md "Analytics dashboards"): the range and interval
 * rules of the analytics endpoints, the filter bar, growth formatting and the headline panel.
 *
 *   const [query, setQuery] = useAnalyticsQuery();
 *   const dashboard = useQuery({ queryKey: [..., analyticsApiParams(query)], queryFn: () => api.get(query) });
 *   <AnalyticsFilters key={JSON.stringify(query)} value={query} onChange={setQuery} served={dashboard.data} />
 *   <StatCard label="Bookings" value={data.bookings} change={toStatChange(data.comparison.bookings)} />
 */
export { AnalyticsFilters, type ServedRange } from './AnalyticsFilters';
export { formatGrowth, rateChange, toStatChange, type Change, type ChangeKind } from './growth';
export { HighlightFigure, HighlightPanel } from './HighlightPanel';
export { FigureStrip, KpiGrid, KpiItem } from './KpiGrid';
export {
  analyticsApiParams,
  analyticsSearchParams,
  autoInterval,
  categoryFormat,
  categoryLabel,
  DEFAULT_ANALYTICS_QUERY,
  describeDays,
  INTERVAL_LABELS,
  INTERVAL_LIMITS,
  intervalAllowed,
  intervalOptions,
  MAX_ANALYTICS_DAYS,
  pointCount,
  presetDays,
  presetLabel,
  PRESET_GROUPS,
  readAnalyticsQuery,
  validateAnalyticsDates,
  withRange,
  writeAnalyticsQuery,
  type AnalyticsInterval,
  type AnalyticsPreset,
  type AnalyticsQuery,
  type AnalyticsRangeEcho,
} from './range';
export { SegmentedControl, type SegmentOption } from './SegmentedControl';
export { useAnalyticsQuery } from './useAnalyticsQuery';
