import { format as formatDate, isValid, parseISO } from 'date-fns';

/**
 * Number and date formats of the chart kit (axes, tooltips, tables, summaries). Indian grouping throughout:
 * ₹2,00,000 in full, ₹2L / ₹1.5Cr in compact form.
 */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });
const count = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

/** 200000 → "₹2,00,000"; with paise: 5913.6 → "₹5,913.60". */
export function formatINR(value: number, { paise = false } = {}): string {
  return (paise ? inrPaise : inr).format(value);
}

/** Axis ticks: 1200 → "₹1,200", 25000 → "₹25K", 200000 → "₹2L", 25000000 → "₹2.5Cr" (full below ₹10,000). */
export function formatINRCompact(value: number): string {
  return Math.abs(value) < 10_000 ? inr.format(value) : inrCompact.format(value);
}

/** 1284 → "1,284" (whole numbers). */
export function formatCount(value: number): string {
  return count.format(value);
}

/** 12.345 → "12.35". */
export function formatNumber(value: number): string {
  return decimal.format(value);
}

/** Axis ticks for plain numbers: 9800 → "9,800", 12900 → "12.9K", 250000 → "2.5L". */
export function formatCompact(value: number): string {
  return Math.abs(value) < 10_000 ? decimal.format(value) : compact.format(value);
}

/** 12.5 → "12.5%" (the value is already a percentage). */
export function formatPercent(value: number): string {
  return `${percent.format(value)}%`;
}

export type ValueFormat = 'number' | 'count' | 'inr' | 'inr-compact' | 'percent' | ((value: number) => string);

/** The full format (tooltips, tables, summaries) and the axis format for a ValueFormat. */
export function resolveValueFormat(valueFormat: ValueFormat = 'number'): { full: (value: number) => string; tick: (value: number) => string } {
  if (typeof valueFormat === 'function') return { full: valueFormat, tick: valueFormat };
  switch (valueFormat) {
    case 'inr':
    case 'inr-compact':
      return { full: (value) => formatINR(value), tick: formatINRCompact };
    case 'count':
      return { full: formatCount, tick: (value) => (Math.abs(value) < 10_000 ? formatCount(value) : compact.format(value)) };
    case 'percent':
      return { full: formatPercent, tick: formatPercent };
    default:
      return { full: formatNumber, tick: formatCompact };
  }
}

/**
 * How dates on the X axis read. The reporting API's intervals map directly: DAY / WEEK → "7 Oct", MONTH → "Oct 2026",
 * YEAR → "2026". `none` leaves the category as it is.
 */
export type DateFormat = 'day' | 'week' | 'month' | 'year' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'none' | ((value: string) => string);

const datePatterns: Record<string, string> = { day: 'd MMM', week: 'd MMM', month: 'MMM yyyy', year: 'yyyy' };

/** "2026-10-07" → "7 Oct" (day), "2026-10" → "Oct 2026" (month), "2026" → "2026" (year). Unparseable values stay as they are. */
export function formatDateCategory(value: string | number, dateFormat: DateFormat = 'none'): string {
  const text = String(value);
  if (typeof dateFormat === 'function') return dateFormat(text);
  const pattern = datePatterns[dateFormat.toLowerCase()];
  if (!pattern) return text;
  const date = parseISO(text);
  return isValid(date) ? formatDate(date, pattern) : text;
}
