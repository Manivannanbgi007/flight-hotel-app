import { plainHeader, plainValue, type CellValue, type PreparedTable } from './table';

/** UTF-8 byte order mark: Excel then opens the file as UTF-8 (₹, names with accents). */
const BOM = '﻿';

/**
 * A spreadsheet runs a cell that starts with one of these as a formula ("CSV injection"); such text gets a leading
 * apostrophe, which Excel and LibreOffice show as plain text. Numbers are never changed.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function textField(text: string): string {
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * RFC 4180 CSV: a header row, then one line per row (CRLF). Text is always quoted; numbers and dates are plain
 * (`1234.50`, `2026-11-19 14:05`) so any program reads them; the header says the unit ("Amount (INR)").
 */
export function toCsv(table: PreparedTable): string {
  const header = table.columns.map((column) => textField(plainHeader(column))).join(',');
  const line = (row: CellValue[]) => row.map((value: CellValue, index) => {
    const column = table.columns[index]!;
    if (value === null) return '';
    return typeof value === 'string' ? textField(value) : plainValue(value, column);
  }).join(',');
  const lines = table.rows.map(line);
  // The totals row is the last line, like in the table on screen.
  if (table.totals) lines.push(line(table.totals));
  return `${BOM}${[header, ...lines].join('\r\n')}\r\n`;
}

export function csvBlob(table: PreparedTable): Blob {
  return new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' });
}
