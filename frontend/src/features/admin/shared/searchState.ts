import { useSearchParams } from 'react-router';

/** `sort=field,asc|desc` (API_DOCUMENTATION.md §1). */
export interface SortState {
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * List filters kept in the URL (shareable, the back button works). `update` sets or removes parameters; any change
 * other than the page goes back to the first page.
 */
export function useSearchState() {
  const [params, setParams] = useSearchParams();
  const update = (changes: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  return { params, update };
}

/** Zero-based page from `?page=` (invalid or negative = 0). */
export function readPage(params: URLSearchParams): number {
  return Math.max(0, Math.floor(Number(params.get('page') ?? 0)) || 0);
}

/** The parameter when it is one of `values`, otherwise '' (= all). */
export function readEnum<T extends string>(params: URLSearchParams, name: string, values: readonly T[]): T | '' {
  const value = params.get(name);
  return values.includes(value as T) ? (value as T) : '';
}

/** `?sort=createdAt,desc` when `field` is one of `fields`; otherwise `fallback`. */
export function readSort(params: URLSearchParams, fields: readonly string[], fallback: SortState | null = null): SortState | null {
  const [field, direction] = (params.get('sort') ?? '').split(',');
  if (field && fields.includes(field)) {
    return { field, direction: direction === 'asc' ? 'asc' : 'desc' };
  }
  return fallback;
}

export function sortParam(sort: SortState | null): string | undefined {
  return sort ? `${sort.field},${sort.direction}` : undefined;
}

/** A `YYYY-MM-DD` date, or '' when the parameter is missing or not a real date. */
export function readDate(params: URLSearchParams, name: string): string {
  const value = params.get(name) ?? '';
  return isIsoDate(value) ? value : '';
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const indiaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The India day (YYYY-MM-DD) of an instant, e.g. a coupon's `validFrom`; '' for none. */
export function indiaDate(instant: string | null | undefined): string {
  if (!instant) return '';
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? '' : indiaDay.format(date);
}

/** The first moment of an India day, as an ISO-8601 instant with offset. */
export const indiaStartOfDay = (isoDate: string) => `${isoDate}T00:00:00+05:30`;
/** The last second of an India day (a coupon valid "until 31 Dec" works all of that day). */
export const indiaEndOfDay = (isoDate: string) => `${isoDate}T23:59:59+05:30`;
