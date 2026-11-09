/** Data export (CSV, Excel, PDF) of the tables of the app. See `frontend/DESIGN_SYSTEM.md` > Data export. */

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

/**
 * How a column's values are written:
 * - `text` as is;
 * - `integer` / `number` with grouping (number: up to 2 decimals);
 * - `money` with 2 decimals and the currency (₹ in Excel and PDF; the code in the CSV header);
 * - `percent` from a value in percent (12.5 = 12.5 %);
 * - `date` from `YYYY-MM-DD` (no time zone); `datetime` from an ISO instant, in the user's time zone.
 * Excel gets real numbers and dates, so the columns sort, filter and add up.
 */
export type ExportCellType = 'text' | 'integer' | 'number' | 'money' | 'percent' | 'date' | 'datetime';

export type ExportValue = string | number | boolean | null | undefined;

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => ExportValue;
  type?: ExportCellType;
  /**
   * ISO 4217 code of a `money` column (default INR), or the row's own code when rows differ (`(row) => row.currency`):
   * then each amount is written in its currency and the CSV header names no unit.
   */
  currency?: string | ((row: T) => string | null | undefined);
  /** Width in characters (Excel) when the content does not say it well, e.g. a long description column. */
  width?: number;
}

/** A filter in force, written into the file ("Status: Confirmed"). */
export interface ExportFilter {
  label: string;
  value: string;
}

export interface ExportRequest<T> {
  /** "Reservations"; the PDF title and the Excel sheet name. */
  title: string;
  /** Whose data it is: "Arabian Sands Beach Resort". */
  subtitle?: string;
  /** The base of the file name ("reservations"); the date and the extension are added. */
  fileName: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /**
   * A totals row below the data, one value per column ('Total' first, then sums or averages; `null` for an empty cell).
   * A text in a typed column is kept as a label. Written bold, outside the Excel filter range, as the PDF table's foot.
   */
  totals?: ExportValue[];
  filters?: ExportFilter[];
  /** "All 312 matching rows" or "Page 2 of 5 (25 rows)". */
  scope?: string;
  /** "Rohan Iyer (Hotel manager)". */
  exportedBy?: string;
  exportedAt?: Date;
}

export interface ExportFile {
  blob: Blob;
  fileName: string;
}

/** The most rows "All matching rows" collects (the same limit as the server's report exports). */
export const EXPORT_ROW_LIMIT = 10_000;
/** A PDF of more rows is hundreds of pages: Excel or CSV are the better choice then. */
export const PDF_ROW_LIMIT = 2_000;

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: 'CSV',
  xlsx: 'Excel',
  pdf: 'PDF',
};
