import { addDays, differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';

import type { StatChange } from '@/components/ui/StatCard';
import type { SummaryParams, SummaryPreset } from './summaryApi';

/**
 * The dashboard's period filter and its comparison with the period before (contract §0.2 and §0.4). Pure functions, so
 * the rules are unit-tested without a page.
 */

export const DEFAULT_PRESET: SummaryPreset = 'LAST_12_MONTHS';

/** Longest custom range the endpoint accepts: five years (§0.2). */
export const MAX_CUSTOM_DAYS = 1827;

export const PRESETS: { value: SummaryPreset; label: string }[] = [
  { value: 'LAST_12_MONTHS', label: 'Last 12 months' },
  { value: 'THIS_YEAR', label: 'This year' },
  { value: 'PREVIOUS_YEAR', label: 'Previous year' },
  { value: 'ALL_TIME', label: 'All time' },
  { value: 'CUSTOM', label: 'Custom' },
];

const isPreset = (value: string | null): value is SummaryPreset => PRESETS.some((preset) => preset.value === value);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that is a real calendar day. */
export function isIsoDate(value: string | null | undefined): value is string {
  return !!value && DATE.test(value) && isValid(parseISO(value)) && format(parseISO(value), 'yyyy-MM-dd') === value;
}

/** Why a custom range cannot be used, or null when it is fine. */
export function validateCustomRange(from: string, to: string): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return 'Choose both dates.';
  }
  const days = differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;
  if (days < 1) {
    return 'The end date must be on or after the start date.';
  }
  if (days > MAX_CUSTOM_DAYS) {
    return 'Choose a period of at most five years.';
  }
  return null;
}

/**
 * The period in the page's URL (`?range=THIS_YEAR`, `?range=CUSTOM&from=…&to=…`), so it survives a reload and can be
 * shared. Anything unknown or invalid falls back to the default (last 12 months).
 */
export function rangeFromSearch(search: URLSearchParams): SummaryParams {
  const range = search.get('range');
  if (!isPreset(range)) {
    return { range: DEFAULT_PRESET };
  }
  if (range === 'CUSTOM') {
    const from = search.get('from') ?? '';
    const to = search.get('to') ?? '';
    return validateCustomRange(from, to) === null ? { range, from, to } : { range: DEFAULT_PRESET };
  }
  return { range };
}

/** The URL query for a period, keeping the page's other parameters. The default period leaves the URL clean. */
export function rangeToSearch(params: SummaryParams, current: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete('range');
  next.delete('from');
  next.delete('to');
  if (params.range !== DEFAULT_PRESET) {
    next.set('range', params.range);
  }
  if (params.range === 'CUSTOM' && params.from && params.to) {
    next.set('from', params.from);
    next.set('to', params.to);
  }
  return next;
}

/**
 * The previous period: the same number of days right before `from` (§0.4, "PREVIOUS_PERIOD"). 1–6 Nov → 26–31 Oct.
 */
export function previousPeriod(range: { from: string; to: string }): { from: string; to: string } {
  const from = parseISO(range.from);
  const days = differenceInCalendarDays(parseISO(range.to), from) + 1;
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  return { from: format(previousFrom, 'yyyy-MM-dd'), to: format(previousTo, 'yyyy-MM-dd') };
}

export type Trend = 'UP' | 'DOWN' | 'FLAT';

export interface Comparison {
  current: number;
  previous: number;
  /** current − previous */
  change: number;
  /** change / |previous| × 100, one decimal; null when previous is 0 and current is not; 0 when both are 0. */
  changePercent: number | null;
  trend: Trend;
}

/** Half away from zero, like the server's HALF_UP: 2.25 → 2.3, −2.25 → −2.3. */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor + Number.EPSILON)) / factor;
}

/** The growth of one figure, by the contract's rules (§0.4). Never Infinity or NaN. */
export function compareFigure(current: number, previous: number): Comparison {
  const change = round(current - previous, 2);
  const changePercent = previous === 0 ? (current === 0 ? 0 : null) : round((change / Math.abs(previous)) * 100, 1);
  const trend: Trend = change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'FLAT';
  return { current, previous, change, changePercent, trend };
}

/**
 * What a KPI card shows for a comparison: nothing when there is no comparison or both periods are empty, "New" when
 * the previous period had nothing, else the percentage.
 */
export function statChangeOf(comparison: Comparison | null, options: Omit<StatChange, 'percent' | 'isNew'> = {}): StatChange | undefined {
  if (!comparison || (comparison.current === 0 && comparison.previous === 0)) {
    return undefined;
  }
  if (comparison.changePercent === null) {
    return { ...options, percent: null, isNew: true };
  }
  return { ...options, percent: comparison.changePercent };
}

/** "1 Nov 2025 – 6 Nov 2026" (one day: "6 Nov 2026"). */
export function formatPeriod(range: { from: string; to: string }): string {
  const from = parseISO(range.from);
  const to = parseISO(range.to);
  if (range.from === range.to) {
    return format(to, 'd MMM yyyy');
  }
  return `${format(from, from.getFullYear() === to.getFullYear() ? 'd MMM' : 'd MMM yyyy')} – ${format(to, 'd MMM yyyy')}`;
}
