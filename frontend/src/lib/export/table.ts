import type { ExportCellType, ExportColumn, ExportValue } from './types';

/** A date in the user's calendar (a `date` column has no time zone; a `datetime` is converted to local time). */
export interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** A cell after preparation: text, a number (money and percent included), a date, or empty. */
export type CellValue = string | number | DateParts | null;

export interface PreparedColumn {
  header: string;
  type: ExportCellType;
  /** The column's currency; with `perRowCurrency` only the fallback. */
  currency: string;
  /** Each row says its currency (`currencies`). */
  perRowCurrency: boolean;
  width?: number;
}

export interface PreparedTable {
  columns: PreparedColumn[];
  rows: CellValue[][];
  /** The currency of each money cell whose currency comes from its row; null elsewhere. */
  currencies: (string | null)[][];
  /** The totals row, or null. */
  totals: CellValue[] | null;
}

const NUMERIC: ReadonlySet<ExportCellType> = new Set(['integer', 'number', 'money', 'percent']);

export const isNumericType = (type: ExportCellType) => NUMERIC.has(type);
export const isDateParts = (value: CellValue): value is DateParts => typeof value === 'object' && value !== null;

/** Columns and rows as typed cells: what every writer starts from. A value that does not fit its type is left empty. */
export function prepareTable<T>(columns: ExportColumn<T>[], rows: T[], totals?: ExportValue[]): PreparedTable {
  const prepared: PreparedColumn[] = columns.map((column) => ({
    header: column.header,
    type: column.type ?? 'text',
    currency: typeof column.currency === 'string' ? column.currency : 'INR',
    perRowCurrency: typeof column.currency === 'function',
    width: column.width,
  }));
  return {
    columns: prepared,
    rows: rows.map((row) => columns.map((column, index) => toCell(column.value(row), prepared[index]!.type))),
    currencies: rows.map((row) => columns.map((column) => {
      if (typeof column.currency !== 'function') return null;
      const code = column.currency(row)?.trim().toUpperCase();
      return code && /^[A-Z]{3}$/.test(code) ? code : null;
    })),
    totals: totals ? prepared.map((column, index) => toTotalCell(totals[index], column.type)) : null,
  };
}

/** A totals cell: typed like its column, but a label ("Total") stays text even in a date or number column. */
function toTotalCell(value: ExportValue, type: ExportCellType): CellValue {
  const cell = toCell(value, type);
  return cell === null && typeof value === 'string' && value.trim() !== '' ? value.trim() : cell;
}

/** The currency a money cell is written in: its row's, else the column's. */
export const cellCurrency = (table: PreparedTable, row: number, column: number): string =>
  table.currencies[row]?.[column] ?? table.columns[column]!.currency;

function toCell(value: ExportValue, type: ExportCellType): CellValue {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'text') {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    const text = String(value).trim();
    return text === '' ? null : text;
  }
  if (NUMERIC.has(type)) {
    const number = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    return Number.isFinite(number) ? number : null;
  }
  return toDateParts(String(value), type === 'datetime');
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-11-19` → 19 Nov 2026 (as written); an instant → the user's local date and time. */
export function toDateParts(text: string, withTime: boolean): DateParts | null {
  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) {
    return { year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]), hour: 0, minute: 0 };
  }
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) return null;
  return {
    year: instant.getFullYear(),
    month: instant.getMonth() + 1,
    day: instant.getDate(),
    hour: withTime ? instant.getHours() : 0,
    minute: withTime ? instant.getMinutes() : 0,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const integerFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const moneyFormats = new Map<string, Intl.NumberFormat>();

function moneyFormat(currency: string): Intl.NumberFormat {
  let format = moneyFormats.get(currency);
  if (!format) {
    try {
      // ₹ for rupees; any other currency by its code ("USD 99.50"): a bare "$" would be ambiguous.
      format = new Intl.NumberFormat('en-IN', { style: 'currency', currency, currencyDisplay: currency === 'INR' ? 'symbol' : 'code',
        minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      format = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    moneyFormats.set(currency, format);
  }
  return format;
}

/** How people read a cell (PDF, column widths): "₹1,234.50", "12.5%", "19 Nov 2026, 14:05". The same style as the app. */
export function displayValue(value: CellValue, column: PreparedColumn, currency: string = column.currency): string {
  if (value === null) return '';
  if (isDateParts(value)) {
    const date = `${value.day} ${MONTHS[value.month - 1]} ${value.year}`;
    return column.type === 'datetime' ? `${date}, ${pad(value.hour)}:${pad(value.minute)}` : date;
  }
  if (typeof value === 'number') {
    switch (column.type) {
      case 'integer': return integerFormat.format(value);
      case 'money': return moneyFormat(currency).format(value);
      case 'percent': return `${percentFormat.format(value)}%`;
      default: return numberFormat.format(value);
    }
  }
  return value;
}

/** For machines (CSV): plain numbers without grouping, ISO-like dates ("2026-11-19 14:05"). */
export function plainValue(value: CellValue, column: PreparedColumn): string {
  if (value === null) return '';
  if (isDateParts(value)) {
    const date = `${value.year}-${pad(value.month)}-${pad(value.day)}`;
    return column.type === 'datetime' ? `${date} ${pad(value.hour)}:${pad(value.minute)}` : date;
  }
  if (typeof value === 'number') {
    if (column.type === 'money') return value.toFixed(2);
    if (column.type === 'integer') return String(Math.round(value));
    return String(Math.round(value * 100) / 100);
  }
  return value;
}

/** The CSV header names the unit the plain numbers are in: "Amount (INR)", "Occupancy (%)". */
export function plainHeader(column: PreparedColumn): string {
  if (column.type === 'money') return column.perRowCurrency ? column.header : `${column.header} (${column.currency})`;
  if (column.type === 'percent') return `${column.header} (%)`;
  return column.header;
}

/** "Reservations: Arabian Sands" → "reservations-arabian-sands"; for file names. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'export';
}

/** `2026-11-09` of the user's day, for the file name. */
export function fileDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "9 Nov 2026, 10:24": when the file was made. */
export function formatExportTime(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
