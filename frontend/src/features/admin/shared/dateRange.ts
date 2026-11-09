import { formatDate } from '@/lib/format';
import { isIsoDate, readDate, readEnum } from './searchState';

/**
 * Date ranges of the reports (API_DOCUMENTATION.md §14.0; api-analytics §6 added the longer presets, each at most
 * 366 days). Days are India days. The dashboards use the analytics ranges (components/analytics).
 */
export type RangePreset =
  | 'TODAY' | 'LAST_7_DAYS' | 'LAST_14_DAYS' | 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'THIS_MONTH' | 'PREVIOUS_MONTH'
  | 'LAST_12_MONTHS' | 'THIS_YEAR' | 'PREVIOUS_YEAR' | 'CUSTOM';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'TODAY', label: 'Today' },
  { value: 'LAST_7_DAYS', label: 'Last 7 days' },
  { value: 'LAST_14_DAYS', label: 'Last 14 days' },
  { value: 'LAST_30_DAYS', label: 'Last 30 days' },
  { value: 'LAST_90_DAYS', label: 'Last 90 days' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'PREVIOUS_MONTH', label: 'Previous month' },
  { value: 'LAST_12_MONTHS', label: 'Last 12 months' },
  { value: 'THIS_YEAR', label: 'This year' },
  { value: 'PREVIOUS_YEAR', label: 'Previous year' },
  { value: 'CUSTOM', label: 'Custom dates' },
];

const PRESET_VALUES = RANGE_PRESETS.map((preset) => preset.value);
export const DEFAULT_PRESET: RangePreset = 'LAST_30_DAYS';
/** Both dates count; at most 366 days (`400 INVALID_RANGE` otherwise). */
export const MAX_RANGE_DAYS = 366;

/** The range the user chose. `from` / `to` (YYYY-MM-DD, inclusive) only for CUSTOM. */
export interface DateRange {
  preset: RangePreset;
  from: string;
  to: string;
}

/** What the server answers with every figure: the preset and the real days it covered. */
export interface RangeEcho {
  preset: RangePreset;
  from: string;
  to: string;
}

const dayNumber = (isoDate: string) => {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

/** Why a custom range cannot be used, or null when it is fine. */
export function validateCustomRange(from: string, to: string): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return 'Choose a start and an end date.';
  }
  if (from > to) {
    return 'The start date must be on or before the end date.';
  }
  if (dayNumber(to) - dayNumber(from) + 1 > MAX_RANGE_DAYS) {
    return `Choose at most ${MAX_RANGE_DAYS} days.`;
  }
  return null;
}

/** The range in the URL (`?range=CUSTOM&from=…&to=…`); a missing or broken one is the last 30 days. */
export function readRange(params: URLSearchParams): DateRange {
  const preset = readEnum(params, 'range', PRESET_VALUES) || DEFAULT_PRESET;
  if (preset !== 'CUSTOM') {
    return { preset, from: '', to: '' };
  }
  const from = readDate(params, 'from');
  const to = readDate(params, 'to');
  return validateCustomRange(from, to) === null ? { preset, from, to } : { preset: DEFAULT_PRESET, from: '', to: '' };
}

/** URL parameters for `range` (the default preset is left out, so a plain link shows the last 30 days). */
export function rangeSearchParams(range: DateRange): Record<string, string | null> {
  const custom = range.preset === 'CUSTOM';
  return {
    range: range.preset === DEFAULT_PRESET ? null : range.preset,
    from: custom ? range.from : null,
    to: custom ? range.to : null,
  };
}

/** API query parameters (`range`, plus `from` and `to` for CUSTOM). */
export function rangeQuery(range: DateRange): { range: RangePreset; from?: string; to?: string } {
  return range.preset === 'CUSTOM' ? { range: 'CUSTOM', from: range.from, to: range.to } : { range: range.preset };
}

export function presetLabel(preset: RangePreset): string {
  return RANGE_PRESETS.find((option) => option.value === preset)?.label ?? preset;
}

/** "7 Oct 2026 – 5 Nov 2026" (one date when both are the same day). */
export function rangeDays(echo: Pick<RangeEcho, 'from' | 'to'>): string {
  return echo.from === echo.to ? formatDate(echo.from) : `${formatDate(echo.from)} – ${formatDate(echo.to)}`;
}
