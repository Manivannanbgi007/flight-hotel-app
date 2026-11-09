import { formatDate, formatDateTime } from '@/lib/format';
import type { FieldKind } from './blocks';

/** A value as the app shows it: dates in the app's date format, everything else exactly as the backend returned it. */
export function formatValue(value: string, kind: FieldKind): string {
  if (kind === 'date') return formatDate(value);
  if (kind === 'datetime') return formatDateTime(value);
  return value;
}
