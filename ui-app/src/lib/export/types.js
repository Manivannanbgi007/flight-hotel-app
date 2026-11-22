/** Data export (CSV, Excel, PDF) of the tables of the app. See `frontend/DESIGN_SYSTEM.md` > Data export. */

/** The most rows "All matching rows" collects (the same limit as the server's report exports). */
export const EXPORT_ROW_LIMIT = 10_000;
/** A PDF of more rows is hundreds of pages: Excel or CSV are the better choice then. */
export const PDF_ROW_LIMIT = 2_000;

export const FORMAT_LABELS = {
  csv: 'CSV',
  xlsx: 'Excel',
  pdf: 'PDF',
};
