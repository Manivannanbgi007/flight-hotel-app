import { format, parseISO } from 'date-fns';

/**
 * Date ranges and intervals of the analytics endpoints (admin dashboard, hotel manager dashboard, support metrics):
 * api-analytics §0.2–0.3. Days are India days (Asia/Kolkata), both ends inclusive.
 */

export type AnalyticsPreset =
  | 'TODAY' | 'LAST_7_DAYS' | 'LAST_14_DAYS' | 'LAST_30_DAYS' | 'LAST_90_DAYS'
  | 'THIS_MONTH' | 'PREVIOUS_MONTH' | 'LAST_12_MONTHS'
  | 'THIS_YEAR' | 'PREVIOUS_YEAR' | 'LAST_3_YEARS' | 'LAST_5_YEARS'
  | 'CUSTOM';

export type AnalyticsInterval = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

/** What a page asks for (kept in the URL). `interval: null` lets the server choose. */
export interface AnalyticsQuery {
  preset: AnalyticsPreset;
  /** YYYY-MM-DD, only for CUSTOM. */
  from: string;
  to: string;
  interval: AnalyticsInterval | null;
}

/** The range every answer echoes back with its real days. */
export interface AnalyticsRangeEcho {
  preset: string;
  from: string;
  to: string;
}

/** The preset menu, grouped. */
export const PRESET_GROUPS: { label: string; presets: { value: AnalyticsPreset; label: string }[] }[] = [
  {
    label: 'Days',
    presets: [
      { value: 'TODAY', label: 'Today' },
      { value: 'LAST_7_DAYS', label: 'Last 7 days' },
      { value: 'LAST_14_DAYS', label: 'Last 14 days' },
      { value: 'LAST_30_DAYS', label: 'Last 30 days' },
      { value: 'LAST_90_DAYS', label: 'Last 90 days' },
    ],
  },
  {
    label: 'Months',
    presets: [
      { value: 'THIS_MONTH', label: 'This month' },
      { value: 'PREVIOUS_MONTH', label: 'Previous month' },
      { value: 'LAST_12_MONTHS', label: 'Last 12 months' },
    ],
  },
  {
    label: 'Years',
    presets: [
      { value: 'THIS_YEAR', label: 'This year' },
      { value: 'PREVIOUS_YEAR', label: 'Previous year' },
      { value: 'LAST_3_YEARS', label: 'Last 3 years' },
      { value: 'LAST_5_YEARS', label: 'Last 5 years' },
    ],
  },
];

export const CUSTOM_LABEL = 'Custom dates';
export const DEFAULT_ANALYTICS_PRESET: AnalyticsPreset = 'LAST_30_DAYS';
export const DEFAULT_ANALYTICS_QUERY: AnalyticsQuery = { preset: DEFAULT_ANALYTICS_PRESET, from: '', to: '', interval: null };
/** Longest range of the analytics endpoints: five years (both days count). */
export const MAX_ANALYTICS_DAYS = 1827;

const PRESETS: AnalyticsPreset[] = [...PRESET_GROUPS.flatMap((group) => group.presets.map((preset) => preset.value)), 'CUSTOM'];
export const INTERVALS: AnalyticsInterval[] = ['DAY', 'WEEK', 'MONTH', 'YEAR'];

/** Most points the server draws per interval (more → `400 INVALID_INTERVAL`). */
export const INTERVAL_LIMITS: Record<AnalyticsInterval, number> = { DAY: 366, WEEK: 262, MONTH: 120, YEAR: 20 };

export const INTERVAL_LABELS: Record<AnalyticsInterval, { label: string; unit: string; units: string; per: string }> = {
  DAY: { label: 'Day', unit: 'day', units: 'days', per: 'per day' },
  WEEK: { label: 'Week', unit: 'week', units: 'weeks', per: 'per week' },
  MONTH: { label: 'Month', unit: 'month', units: 'months', per: 'per month' },
  YEAR: { label: 'Year', unit: 'year', units: 'years', per: 'per year' },
};

export function presetLabel(preset: string): string {
  if (preset === 'CUSTOM') return CUSTOM_LABEL;
  for (const group of PRESET_GROUPS) {
    const match = group.presets.find((option) => option.value === preset);
    if (match) return match.label;
  }
  return preset;
}

// ---- day arithmetic on YYYY-MM-DD (UTC day numbers, no time zone surprises) ----

export function isIsoDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dayNumber(isoDay: string): number {
  const [year, month, day] = isoDay.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function fromDayNumber(days: number): string {
  return new Date(days * 86_400_000).toISOString().slice(0, 10);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Days in `from … to`, both included. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

const indiaDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today in India (the day the server's ranges are built on). */
export function indiaToday(now: Date = new Date()): string {
  return indiaDayFormat.format(now);
}

/** The days a preset covers on `today` (§0.2). CUSTOM: the given dates. */
export function presetDays(query: Pick<AnalyticsQuery, 'preset' | 'from' | 'to'>, today: string = indiaToday()): { from: string; to: string } {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const back = (days: number) => ({ from: fromDayNumber(dayNumber(today) - days), to: today });
  switch (query.preset) {
    case 'TODAY': return { from: today, to: today };
    case 'LAST_7_DAYS': return back(6);
    case 'LAST_14_DAYS': return back(13);
    case 'LAST_30_DAYS': return back(29);
    case 'LAST_90_DAYS': return back(89);
    case 'THIS_MONTH': return { from: `${year}-${pad(month)}-01`, to: today };
    case 'PREVIOUS_MONTH': {
      const firstOfThis = dayNumber(`${year}-${pad(month)}-01`);
      const last = fromDayNumber(firstOfThis - 1);
      return { from: `${last.slice(0, 7)}-01`, to: last };
    }
    case 'LAST_12_MONTHS': {
      const index = year * 12 + (month - 1) - 11;
      return { from: `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`, to: today };
    }
    case 'THIS_YEAR': return { from: `${year}-01-01`, to: today };
    case 'PREVIOUS_YEAR': return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case 'LAST_3_YEARS': return { from: `${year - 2}-01-01`, to: today };
    case 'LAST_5_YEARS': return { from: `${year - 4}-01-01`, to: today };
    case 'CUSTOM': return { from: query.from, to: query.to };
  }
}

/** Monday of the ISO week of a day number (1970-01-01 was a Thursday). */
const mondayOf = (days: number) => days - (((days + 3) % 7) + 7) % 7;

/** Points of a series for `from … to` at `interval` (first and last cut to the range, so they count). */
export function pointCount(from: string, to: string, interval: AnalyticsInterval): number {
  switch (interval) {
    case 'DAY': return daysBetween(from, to);
    case 'WEEK': return (mondayOf(dayNumber(to)) - mondayOf(dayNumber(from))) / 7 + 1;
    case 'MONTH': {
      const [y1, m1] = from.split('-').map(Number) as [number, number];
      const [y2, m2] = to.split('-').map(Number) as [number, number];
      return (y2 * 12 + m2) - (y1 * 12 + m1) + 1;
    }
    case 'YEAR': return Number(to.slice(0, 4)) - Number(from.slice(0, 4)) + 1;
  }
}

/** The interval the server picks without `interval` (§0.3): ≤ 31 days DAY, ≤ 92 WEEK, ≤ 731 MONTH, longer YEAR. */
export function autoInterval(from: string, to: string): AnalyticsInterval {
  const days = daysBetween(from, to);
  if (days <= 31) return 'DAY';
  if (days <= 92) return 'WEEK';
  if (days <= 731) return 'MONTH';
  return 'YEAR';
}

export interface IntervalOption {
  value: AnalyticsInterval;
  label: string;
  points: number;
  /** False when the server would answer 400 INVALID_INTERVAL (too many points). */
  allowed: boolean;
  /** Why it is not allowed, in words. */
  reason: string | null;
}

const count = new Intl.NumberFormat('en-IN');

/** The four intervals for a range, with the ones the server would refuse marked and explained. */
export function intervalOptions(from: string, to: string): IntervalOption[] {
  return INTERVALS.map((value) => {
    const points = pointCount(from, to, value);
    const limit = INTERVAL_LIMITS[value];
    const allowed = points <= limit;
    const words = INTERVAL_LABELS[value];
    return {
      value,
      label: words.label,
      points,
      allowed,
      reason: allowed
        ? null
        : `${words.label}: this range has ${count.format(points)} ${words.units}, at most ${count.format(limit)} can be shown. Choose a longer interval.`,
    };
  });
}

/** Can `interval` be asked for on these days? */
export function intervalAllowed(from: string, to: string, interval: AnalyticsInterval): boolean {
  return pointCount(from, to, interval) <= INTERVAL_LIMITS[interval];
}

/** Why custom dates cannot be used, or null when they are fine (both inclusive, at most five years). */
export function validateAnalyticsDates(from: string, to: string): string | null {
  if (!isIsoDay(from) || !isIsoDay(to)) return 'Choose a start and an end date.';
  if (from > to) return 'The start date must be on or before the end date.';
  if (daysBetween(from, to) > MAX_ANALYTICS_DAYS) return 'Choose at most five years (1,827 days).';
  return null;
}

/**
 * The query in the URL: `?range=THIS_YEAR&interval=WEEK` or `?range=CUSTOM&from=…&to=…`. A missing or broken range is
 * the last 30 days; an interval the server would refuse for the range is dropped (the server then chooses).
 */
export function readAnalyticsQuery(params: URLSearchParams, today: string = indiaToday()): AnalyticsQuery {
  const rawPreset = (params.get('range') ?? '').toUpperCase() as AnalyticsPreset;
  let preset: AnalyticsPreset = PRESETS.includes(rawPreset) ? rawPreset : DEFAULT_ANALYTICS_PRESET;
  let from = '';
  let to = '';
  if (preset === 'CUSTOM') {
    from = params.get('from') ?? '';
    to = params.get('to') ?? '';
    if (validateAnalyticsDates(from, to) !== null) {
      preset = DEFAULT_ANALYTICS_PRESET;
      from = '';
      to = '';
    }
  }
  const rawInterval = (params.get('interval') ?? '').toUpperCase() as AnalyticsInterval;
  const days = presetDays({ preset, from, to }, today);
  const interval = INTERVALS.includes(rawInterval) && intervalAllowed(days.from, days.to, rawInterval) ? rawInterval : null;
  return { preset, from, to, interval };
}

/** URL parameters of a query (defaults left out, so a plain link shows the last 30 days chosen by the server). */
export function analyticsSearchParams(query: AnalyticsQuery): Record<string, string | null> {
  const custom = query.preset === 'CUSTOM';
  return {
    range: query.preset === DEFAULT_ANALYTICS_PRESET ? null : query.preset,
    from: custom ? query.from : null,
    to: custom ? query.to : null,
    interval: query.interval,
  };
}

/** Writes the query into `params`; other parameters stay. */
export function writeAnalyticsQuery(params: URLSearchParams, query: AnalyticsQuery): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [name, value] of Object.entries(analyticsSearchParams(query))) {
    if (value) next.set(name, value);
    else next.delete(name);
  }
  return next;
}

/** Query parameters of the API call (`range`, `from`/`to` for CUSTOM, `interval` only when chosen). */
export function analyticsApiParams(query: AnalyticsQuery): Record<string, string> {
  return {
    range: query.preset,
    ...(query.preset === 'CUSTOM' ? { from: query.from, to: query.to } : {}),
    ...(query.interval ? { interval: query.interval } : {}),
  };
}

/**
 * A new range keeps the chosen interval only when the server accepts it for the new days; otherwise the server
 * chooses again.
 */
export function withRange(query: AnalyticsQuery, next: Pick<AnalyticsQuery, 'preset' | 'from' | 'to'>, today: string = indiaToday()): AnalyticsQuery {
  const days = presetDays(next, today);
  const keep = query.interval && intervalAllowed(days.from, days.to, query.interval) ? query.interval : null;
  return { ...next, interval: keep };
}

/** "8 Oct – 6 Nov 2026", "25 Feb 2025 – 31 Dec 2025", or one day "6 Nov 2026". */
export function describeDays(range: Pick<AnalyticsRangeEcho, 'from' | 'to'>): string {
  if (!isIsoDay(range.from) || !isIsoDay(range.to)) return '';
  const from = parseISO(range.from);
  const to = parseISO(range.to);
  if (range.from === range.to) return format(to, 'd MMM yyyy');
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${format(from, sameYear ? 'd MMM' : 'd MMM yyyy')} – ${format(to, 'd MMM yyyy')}`;
}

/**
 * How the X axis and the table read a point's `start` day: days and weeks "7 Oct" (with the year when the range spans
 * years: "7 Oct 25"), months "Oct 2026", years "2026".
 */
export function categoryFormat(interval: AnalyticsInterval, range?: Pick<AnalyticsRangeEcho, 'from' | 'to'> | null): (value: string) => string {
  const spansYears = !!range && range.from.slice(0, 4) !== range.to.slice(0, 4);
  const pattern = interval === 'YEAR' ? 'yyyy' : interval === 'MONTH' ? 'MMM yyyy' : spansYears ? 'd MMM yy' : 'd MMM';
  return (value: string) => (isIsoDay(value) ? format(parseISO(value), pattern) : value);
}

/** Header of the table's first column for the interval. */
export function categoryLabel(interval: AnalyticsInterval): string {
  return interval === 'WEEK' ? 'Week from' : interval === 'MONTH' ? 'Month' : interval === 'YEAR' ? 'Year' : 'Date';
}
