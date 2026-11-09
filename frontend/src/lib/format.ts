import { format, parseISO } from 'date-fns';

/**
 * `2026-05-17` → "17 May 2026". Date-only values are read as LOCAL dates (`new Date('2026-05-17')` would be UTC
 * midnight and show the previous day west of Greenwich).
 */
export function formatDate(isoDate: string | null | undefined): string {
  return isoDate ? format(parseISO(isoDate), 'd MMM yyyy') : '';
}

/** Instant (`2026-11-05T10:15:30Z`) in the user's time zone: "5 Nov 2026, 15:45". */
export function formatDateTime(isoInstant: string | null | undefined): string {
  return isoInstant ? format(parseISO(isoInstant), 'd MMM yyyy, HH:mm') : '';
}

const moneyFormats = new Map<string, Intl.NumberFormat>();

/** 2816 → "₹2,816"; with decimals: 5913.6 → "₹5,913.60". Indian digit grouping (₹1,23,456). */
export function formatMoney(amount: number | null | undefined, currency = 'INR', decimals = false): string {
  if (amount === null || amount === undefined) return '';
  const key = currency + decimals;
  let formatter = moneyFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    });
    moneyFormats.set(key, formatter);
  }
  return formatter.format(amount);
}

/** 84213 → "82 KB", 1572864 → "1.5 MB", 1288490189 → "1.2 GB". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** "2026-12-24" → "Thu, 24 Dec". */
export function formatShortDate(isoDate: string): string {
  return format(parseISO(isoDate), 'EEE, d MMM');
}
