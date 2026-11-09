import { strToU8, zipSync, type Zippable } from 'fflate';

import {
  cellCurrency, displayValue, formatExportTime, isDateParts, isNumericType, type CellValue, type DateParts, type PreparedTable,
} from './table';
import type { ExportFilter } from './types';

/**
 * A small Office Open XML (.xlsx) writer: a "data" sheet (bold header row on a dark band, frozen, with filter buttons,
 * real numbers and dates with formats, column widths from the content, A4 landscape and the header repeated when
 * printed) and an "About this export" sheet (title, time, who, scope, filters). Strings are inline, so no cell can
 * ever be a formula. The package is zipped with fflate.
 */

export interface WorkbookInfo {
  title: string;
  subtitle?: string;
  filters: ExportFilter[];
  scope?: string;
  exportedBy?: string;
  exportedAt: Date;
}

/** Style indexes of `cellXfs` in styles.xml. */
const STYLE = {
  default: 0,
  header: 1,
  integer: 2,
  number: 3,
  money: 4,
  date: 5,
  datetime: 6,
  percent: 7,
  title: 8,
  headerRight: 9,
  label: 10,
  wrap: 11,
} as const;

/** The same formats, bold with a line above: the totals row. */
const TOTAL = {
  default: 12,
  integer: 13,
  number: 14,
  money: 15,
  date: 16,
  datetime: 17,
  percent: 18,
} as const;

type Styles = { [K in keyof typeof TOTAL]: number };

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

export function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Excel's serial date: days since 30 Dec 1899, the time as a fraction. */
export function excelSerial(date: DateParts): number {
  const days = Math.round((Date.UTC(date.year, date.month - 1, date.day) - Date.UTC(1899, 11, 30)) / 86_400_000);
  const minutes = date.hour * 60 + date.minute;
  return minutes === 0 ? days : days + minutes / 1440;
}

/** Sheet names: at most 31 characters, none of : \ / ? * [ ]. */
export function sheetName(title: string): string {
  const cleaned = title.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31).trim();
  return cleaned || 'Data';
}

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;

function textCell(ref: string, text: string, style: number = STYLE.default): string {
  const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  const s = style ? ` s="${style}"` : '';
  return `<c r="${ref}" t="inlineStr"${s}><is><t${space}>${escapeXml(text)}</t></is></c>`;
}

function numberCell(ref: string, value: number, style: number): string {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

function dataSheet(table: PreparedTable): string {
  const columnCount = table.columns.length;
  const lastColumn = columnName(Math.max(columnCount - 1, 0));
  const lastRow = table.rows.length + 1;
  // The filter (and sorting) covers the header and the rows; the totals row stays below them.
  const range = `A1:${lastColumn}${lastRow}`;
  const dimension = `A1:${lastColumn}${lastRow + (table.totals ? 1 : 0)}`;

  // Width: the longest of the header and the cells as people read them, within 8 and 60 characters.
  const widths = table.columns.map((column, index) => {
    if (column.width) return column.width;
    let longest = column.header.length + 3; // + the filter button
    for (const row of table.rows) {
      const shown = displayValue(row[index] ?? null, column);
      const firstLine = shown.split('\n')[0] ?? '';
      if (firstLine.length > longest) longest = firstLine.length;
    }
    return Math.min(Math.max(Math.ceil(longest * 1.1) + 2, 8), 60);
  });

  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const header = table.columns.map((column, index) =>
    textCell(`${columnName(index)}1`, column.header, isNumericType(column.type) ? STYLE.headerRight : STYLE.header)).join('');

  const writeRow = (row: CellValue[], r: number, styles: Styles, rowIndex: number | null) => row.map((value, index) => {
    if (value === null) return '';
    const column = table.columns[index]!;
    const ref = `${columnName(index)}${r}`;
    if (isDateParts(value)) return numberCell(ref, excelSerial(value), column.type === 'datetime' ? styles.datetime : styles.date);
    if (typeof value === 'number') {
      switch (column.type) {
        case 'integer': return numberCell(ref, value, styles.integer);
        // ₹ for rupees; another currency keeps 2 decimals (the file's currency column names it).
        case 'money': {
          const currency = rowIndex === null ? column.currency : cellCurrency(table, rowIndex, index);
          return numberCell(ref, value, currency === 'INR' ? styles.money : styles.number);
        }
        case 'percent': return numberCell(ref, value / 100, styles.percent);
        default: return numberCell(ref, value, styles.number);
      }
    }
    return textCell(ref, value, rowIndex !== null && value.includes('\n') ? STYLE.wrap : styles.default);
  }).join('');

  const body = table.rows.map((row, rowIndex) => `<row r="${rowIndex + 2}">${writeRow(row, rowIndex + 2, STYLE, rowIndex)}</row>`).join('')
    + (table.totals ? `<row r="${lastRow + 1}">${writeRow(table.totals, lastRow + 1, TOTAL, null)}</row>` : '');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">`
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<dimension ref="${dimension}"/>`
    + '<sheetViews><sheetView workbookViewId="0" tabSelected="1">'
    + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<cols>${cols}</cols>`
    + `<sheetData><row r="1" ht="22" customHeight="1">${header}</row>${body}</sheetData>`
    + `<autoFilter ref="${range}"/>`
    + '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '</worksheet>';
}

function aboutSheet(info: WorkbookInfo, rowCount: number): string {
  const rows: string[] = [];
  let r = 1;
  const add = (cells: string) => { rows.push(`<row r="${r}">${cells}</row>`); r += 1; };
  add(textCell(`A${r}`, info.title, STYLE.title));
  if (info.subtitle) add(textCell(`A${r}`, info.subtitle));
  r += 1;
  add(textCell(`A${r}`, 'Exported', STYLE.label) + textCell(`B${r}`, formatExportTime(info.exportedAt)));
  if (info.exportedBy) add(textCell(`A${r}`, 'Exported by', STYLE.label) + textCell(`B${r}`, info.exportedBy));
  add(textCell(`A${r}`, 'Rows', STYLE.label) + numberCell(`B${r}`, rowCount, STYLE.integer));
  if (info.scope) add(textCell(`A${r}`, 'Rows included', STYLE.label) + textCell(`B${r}`, info.scope));
  r += 1;
  add(textCell(`A${r}`, 'Filters and sorting', STYLE.label) + textCell(`B${r}`, info.filters.length ? '' : 'None: every row you can see'));
  for (const filter of info.filters) add(textCell(`A${r}`, filter.label) + textCell(`B${r}`, filter.value));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">`
    + '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + '<cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="70" customWidth="1"/></cols>'
    + `<sheetData>${rows.join('')}</sheetData>`
    + '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
    + '</worksheet>';
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<styleSheet xmlns="${NS}">`
  + '<numFmts count="4">'
  + '<numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##0.00"/>'
  + '<numFmt numFmtId="165" formatCode="dd mmm yyyy"/>'
  + '<numFmt numFmtId="166" formatCode="dd mmm yyyy hh:mm"/>'
  + '<numFmt numFmtId="167" formatCode="0.0%"/>'
  + '</numFmts>'
  + '<fonts count="5">'
  + '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
  + '<font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FF334155"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
  + '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
  + '</fonts>'
  + '<fills count="3">'
  + '<fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left/><right/><top style="thin"><color rgb="FF94A3B8"/></top><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="19">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
  + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
  + '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  // 12-18: the totals row (bold, a line above) in the formats of 0, 2, 3, 4, 5, 6 and 7.
  + '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>'
  + '<xf numFmtId="3" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'
  + '<xf numFmtId="4" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'
  + '<xf numFmtId="164" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'
  + '<xf numFmtId="165" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
  + '<xf numFmtId="166" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
  + '<xf numFmtId="167" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

function isoInstant(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** The workbook as bytes. */
export function toXlsx(table: PreparedTable, info: WorkbookInfo): Uint8Array {
  const data = sheetName(info.title);
  const about = 'About this export';
  const range = `$A$1:$${columnName(Math.max(table.columns.length - 1, 0))}$${table.rows.length + 1}`;
  const files: Zippable = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
      + '</Types>'),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
      + '</Relationships>'),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
      + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
      + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + `<dc:title>${escapeXml(info.subtitle ? `${info.title}: ${info.subtitle}` : info.title)}</dc:title>`
      + '<dc:creator>FlightHotel</dc:creator>'
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${isoInstant(info.exportedAt)}</dcterms:created>`
      + '</cp:coreProperties>'),
    'docProps/app.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>FlightHotel</Application></Properties>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<workbook xmlns="${NS}" xmlns:r="${REL_NS}">`
      + '<bookViews><workbookView activeTab="0"/></bookViews>'
      + `<sheets><sheet name="${escapeXml(data)}" sheetId="1" r:id="rId1"/><sheet name="${about}" sheetId="2" r:id="rId2"/></sheets>`
      + '<definedNames>'
      + `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${escapeXml(quoteSheet(data))}!${range}</definedName>`
      + `<definedName name="_xlnm.Print_Titles" localSheetId="0">${escapeXml(quoteSheet(data))}!$1:$1</definedName>`
      + '</definedNames>'
      + '</workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>'),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(dataSheet(table)),
    'xl/worksheets/sheet2.xml': strToU8(aboutSheet(info, table.rows.length)),
  };
  return zipSync(files, { level: 6, mtime: info.exportedAt });
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function xlsxBlob(table: PreparedTable, info: WorkbookInfo): Blob {
  return new Blob([toXlsx(table, info) as BlobPart], { type: XLSX_TYPE });
}
