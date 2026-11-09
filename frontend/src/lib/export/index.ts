import { csvBlob } from './csv';
import { fileDate, prepareTable, slugify } from './table';
import { PDF_ROW_LIMIT, type ExportFile, type ExportFilter, type ExportFormat, type ExportRequest } from './types';

export * from './types';
export { collectAllRows, ExportTooLargeError, type CollectOptions, type PageFetcher } from './collect';

const EXTENSIONS: Record<ExportFormat, string> = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' };

/** The filters in force for the file: `[label, value]` pairs, empty values left out. */
export function describeFilters(entries: [string, string | number | null | undefined | false][]): ExportFilter[] {
  return entries.flatMap(([label, value]) => (value === null || value === undefined || value === false || value === ''
    ? []
    : [{ label, value: String(value) }]));
}

/**
 * Builds the file of an export. The Excel and PDF writers (and jsPDF, the fonts) are loaded only when somebody
 * exports, so no page carries them.
 */
export async function createExportFile<T>(format: ExportFormat, request: ExportRequest<T>): Promise<ExportFile> {
  if (format === 'pdf' && request.rows.length > PDF_ROW_LIMIT) {
    throw new RangeError(`A PDF holds at most ${PDF_ROW_LIMIT.toLocaleString('en-IN')} rows. Choose Excel or CSV, or narrow the filters.`);
  }
  const exportedAt = request.exportedAt ?? new Date();
  const table = prepareTable(request.columns, request.rows, request.totals);
  const info = {
    title: request.title,
    subtitle: request.subtitle,
    filters: request.filters ?? [],
    scope: request.scope,
    exportedBy: request.exportedBy,
    exportedAt,
  };
  const fileName = `${slugify(request.fileName)}-${fileDate(exportedAt)}.${EXTENSIONS[format]}`;
  if (format === 'csv') {
    return { blob: csvBlob(table), fileName };
  }
  if (format === 'xlsx') {
    const { xlsxBlob } = await import('./xlsx');
    return { blob: xlsxBlob(table, info), fileName };
  }
  const { pdfBlob } = await import('./pdf');
  return { blob: await pdfBlob(table, info), fileName };
}
