import { differenceInCalendarDays, isValid, parseISO } from 'date-fns';

import { formatDate } from '@/lib/format';
import type { DateRangeQuery, RangeEcho, RangePreset } from './operationsTypes';

/** §14.0 presets, in the order the period menu shows them. */
export const RANGE_PRESETS: readonly RangePreset[] = [
  'TODAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_MONTH', 'PREVIOUS_MONTH', 'LAST_12_MONTHS',
  'THIS_YEAR', 'PREVIOUS_YEAR', 'CUSTOM',
];

export const RANGE_LABELS: Record<RangePreset, string> = {
  TODAY: 'Today',
  LAST_7_DAYS: 'Last 7 days',
  LAST_14_DAYS: 'Last 14 days',
  LAST_30_DAYS: 'Last 30 days',
  THIS_MONTH: 'This month',
  PREVIOUS_MONTH: 'Previous month',
  LAST_90_DAYS: 'Last 90 days',
  LAST_12_MONTHS: 'Last 12 months',
  THIS_YEAR: 'This year',
  PREVIOUS_YEAR: 'Previous year',
  CUSTOM: 'Custom dates',
};

export const DEFAULT_RANGE: DateRangeQuery = { range: 'LAST_30_DAYS' };

/** Both dates count, so 1 Jan – 1 Jan is one day. */
export const MAX_RANGE_DAYS = 366;

export function isIsoDate(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));
}

/** Why a custom range cannot be used, in words; null when it is fine. */
export function rangeProblem(from: string, to: string): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return 'Choose a start and an end date';
  if (from > to) return 'The start date must be on or before the end date';
  if (differenceInCalendarDays(parseISO(to), parseISO(from)) + 1 > MAX_RANGE_DAYS) return `Choose at most ${MAX_RANGE_DAYS} days`;
  return null;
}

/** The range in the URL (`?range=…&from=&to=`). Anything unknown or broken falls back to the last 30 days. */
export function readRange(params: URLSearchParams): DateRangeQuery {
  const range = params.get('range') as RangePreset | null;
  if (!range || !RANGE_PRESETS.includes(range)) return DEFAULT_RANGE;
  if (range !== 'CUSTOM') return { range };
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  return rangeProblem(from, to) === null ? { range, from, to } : DEFAULT_RANGE;
}

/** Writes the range into `params` (other parameters stay); the default range is left out so links stay short. */
export function writeRange(params: URLSearchParams, range: DateRangeQuery): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('from');
  next.delete('to');
  if (range.range === DEFAULT_RANGE.range) {
    next.delete('range');
  } else {
    next.set('range', range.range);
  }
  if (range.range === 'CUSTOM' && range.from && range.to) {
    next.set('from', range.from);
    next.set('to', range.to);
  }
  return next;
}

/** "7 Oct 2026 – 5 Nov 2026", or one date when the range is a single day. */
export function describeRange(range: Pick<RangeEcho, 'from' | 'to'>): string {
  return range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`;
}
