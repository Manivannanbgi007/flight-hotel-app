import { formatDate, formatDateTime } from '@/lib/format';

/** A value as the app shows it: dates in the app's date format, everything else exactly as the backend returned it. */
export function formatValue(value, kind) {
  if (kind === 'date') return formatDate(value);
  if (kind === 'datetime') return formatDateTime(value);
  return value;
}
