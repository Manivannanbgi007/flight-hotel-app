import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

import interBoldUrl from './fonts/Inter-Bold.ttf?url';
import interRegularUrl from './fonts/Inter-Regular.ttf?url';
import { cellCurrency, displayValue, formatExportTime, isNumericType, type PreparedTable } from './table';
import type { ExportFilter } from './types';

/**
 * The table as an A4 PDF report: the title, whose data it is and the filters on top, the table with its header row
 * repeated on every page (numbers right-aligned, striped rows), and a footer with the export time, who exported and
 * "Page n of m". Landscape for wide tables. Inter is embedded (subset), so ₹ and every name print correctly.
 */

export interface PdfInfo {
  title: string;
  subtitle?: string;
  filters: ExportFilter[];
  scope?: string;
  exportedBy?: string;
  exportedAt: Date;
}

/** The Inter TTFs as binary strings (jsPDF's virtual file system). Tests pass their own. */
export interface PdfFonts {
  regular: string;
  bold: string;
}

const SLATE_900: [number, number, number] = [15, 23, 42];
const SLATE_600: [number, number, number] = [71, 85, 105];
const SLATE_200: [number, number, number] = [226, 232, 240];
const HEAD: [number, number, number] = [30, 41, 59];
const STRIPE: [number, number, number] = [248, 250, 252];
const BRAND: [number, number, number] = [31, 92, 232];
const MARGIN = 36;

let fontCache: Promise<PdfFonts> | null = null;

async function binaryOf(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font ${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return binary;
}

/** Loaded once per page visit, only when somebody exports a PDF. */
export function loadInterFonts(): Promise<PdfFonts> {
  fontCache ??= Promise.all([binaryOf(interRegularUrl), binaryOf(interBoldUrl)])
    .then(([regular, bold]) => ({ regular, bold }))
    .catch((error: unknown) => {
      fontCache = null;
      throw error;
    });
  return fontCache;
}

/** Wide tables (many or long columns) go landscape. */
function landscape(table: PreparedTable): boolean {
  if (table.columns.length > 6) return true;
  const sample = table.rows.slice(0, 50);
  const width = table.columns.reduce((sum, column, index) => {
    const longest = sample.reduce((max, row) => Math.max(max, displayValue(row[index] ?? null, column).length), column.header.length);
    return sum + Math.min(longest, 40);
  }, 0);
  return width > 90;
}

export function toPdf(table: PreparedTable, info: PdfInfo, fonts: PdfFonts | null): jsPDF {
  const doc = new jsPDF({ orientation: landscape(table) ? 'landscape' : 'portrait', unit: 'pt', format: 'a4', compress: true });
  let font = 'helvetica';
  if (fonts) {
    doc.addFileToVFS('Inter-Regular.ttf', fonts.regular);
    doc.addFileToVFS('Inter-Bold.ttf', fonts.bold);
    doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
    doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
    font = 'Inter';
  }
  // Without the embedded font (it could not be loaded), the standard font has no ₹.
  const text = (value: string) => (fonts ? value : value.replace(/₹/g, 'Rs. '));
  doc.setProperties({ title: info.subtitle ? `${info.title}: ${info.subtitle}` : info.title, creator: 'FlightHotel', author: info.exportedBy ?? '' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;

  // First page: title, subtitle, then the filters and scope (wrapped); later pages: the title line only.
  doc.setFont(font, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...SLATE_900);
  doc.text(text(info.title), MARGIN, MARGIN + 10);
  let y = MARGIN + 28;
  doc.setFont(font, 'normal');
  doc.setFontSize(10);
  if (info.subtitle) {
    doc.setTextColor(...SLATE_600);
    doc.text(text(info.subtitle), MARGIN, y);
    y += 15;
  }
  const facts = [
    ...(info.scope ? [info.scope] : []),
    info.filters.length
      ? `Filters and sorting: ${info.filters.map((filter) => `${filter.label}: ${filter.value}`).join(' · ')}`
      : 'Filters: none (every row you can see)',
  ];
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_600);
  for (const line of facts) {
    const wrapped = doc.splitTextToSize(text(line), contentWidth) as string[];
    doc.text(wrapped, MARGIN, y);
    y += wrapped.length * 11;
  }

  const numeric = table.columns.map((column) => isNumericType(column.type));
  // Numbers, money and dates stay on one line ("19 Nov 2026", "₹28,560.00"); text columns share the rest and wrap.
  const compact = table.columns.map((column, index) => numeric[index] || column.type === 'date' || column.type === 'datetime');
  autoTable(doc, {
    startY: y + 8,
    margin: { top: MARGIN + 28, right: MARGIN, bottom: MARGIN + 18, left: MARGIN },
    head: [table.columns.map((column) => text(column.header))],
    body: table.rows.map((row, rowIndex) => row.map((value, index) =>
      text(displayValue(value, table.columns[index]!, cellCurrency(table, rowIndex, index))))),
    theme: 'striped',
    styles: {
      font,
      fontSize: table.columns.length > 9 ? 7.5 : 8.5,
      textColor: SLATE_900,
      cellPadding: { top: 4, right: 5, bottom: 4, left: 5 },
      lineColor: SLATE_200,
      lineWidth: { bottom: 0.5 },
      overflow: 'linebreak',
      valign: 'top',
    },
    headStyles: { font, fontStyle: 'bold', fillColor: HEAD, textColor: [255, 255, 255], valign: 'middle' },
    alternateRowStyles: { fillColor: STRIPE },
    columnStyles: Object.fromEntries(table.columns.map((_, index) => [index, {
      ...(numeric[index] ? { halign: 'right' as const } : {}),
      ...(compact[index] ? { cellWidth: 'wrap' as const } : {}),
    }])),
    // The totals row closes the table on its last page, bold on a light band.
    foot: table.totals ? [table.totals.map((value, index) => text(displayValue(value, table.columns[index]!)))] : undefined,
    showFoot: 'lastPage',
    footStyles: { font, fontStyle: 'bold', fillColor: [241, 245, 249], textColor: SLATE_900 },
    didParseCell: (data) => {
      if (data.section !== 'body' && numeric[data.column.index]) data.cell.styles.halign = 'right';
    },
    showHead: 'everyPage',
  });

  // Every page: the brand on the right of the top line, the title on later pages, and the footer.
  const pages = doc.getNumberOfPages();
  const footer = text(`Exported ${formatExportTime(info.exportedAt)}${info.exportedBy ? ` by ${info.exportedBy}` : ''} · ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}`);
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont(font, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND);
    doc.text('FlightHotel', pageWidth - MARGIN, MARGIN + 10, { align: 'right' });
    if (page > 1) {
      doc.setFontSize(11);
      doc.setTextColor(...SLATE_900);
      doc.text(text(info.subtitle ? `${info.title} · ${info.subtitle}` : info.title), MARGIN, MARGIN + 10);
    }
    doc.setDrawColor(...SLATE_200);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, pageHeight - MARGIN, pageWidth - MARGIN, pageHeight - MARGIN);
    doc.setFont(font, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...SLATE_600);
    doc.text(footer, MARGIN, pageHeight - MARGIN + 12);
    doc.text(`Page ${page} of ${pages}`, pageWidth - MARGIN, pageHeight - MARGIN + 12, { align: 'right' });
  }
  return doc;
}

export async function pdfBlob(table: PreparedTable, info: PdfInfo, fonts?: PdfFonts | null): Promise<Blob> {
  let embedded = fonts ?? null;
  if (fonts === undefined) {
    try {
      embedded = await loadInterFonts();
    } catch {
      embedded = null;
    }
  }
  return toPdf(table, info, embedded).output('blob');
}
