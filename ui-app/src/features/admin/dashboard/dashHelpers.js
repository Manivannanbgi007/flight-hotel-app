import { categoryFormat, categoryLabel } from '@/components/analytics';

/** The change of a count against the previous period, as the stat chip understands it. */
export function countTrend(current, previous) {
  const period = 'vs previous period';
  if (previous === 0) {
    return current === 0 ? { percent: 0, period } : { percent: null, isNew: true, period };
  }
  return { percent: ((current - previous) / previous) * 100, period };
}

/** Chart settings that every trend chart of the dashboard shares (the server's interval, the range's days). */
export function chartBase(data) {
  const interval = data?.interval ?? 'DAY';
  return {
    data: data?.series ?? [],
    xKey: 'start',
    xFormat: categoryFormat(interval, data?.range),
    xLabel: categoryLabel(interval),
  };
}

/** `share` of a whole in percent (0 for an empty whole). */
export const share = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
