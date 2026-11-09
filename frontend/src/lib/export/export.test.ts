import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';

import { ApiError } from '@/lib/api/apiError';
import type { Page } from '@/lib/api/types';
import { collectAllRows, ExportTooLargeError } from './collect';
import { toCsv } from './csv';
import { createExportFile, describeFilters } from './index';
import { toPdf } from './pdf';
import { displayValue, prepareTable, slugify } from './table';
import type { ExportColumn } from './types';
import { columnName, excelSerial, sheetName, toXlsx } from './xlsx';

interface Row {
  guest: string;
  nights: number;
  amount: number | null;
  occupancy: number;
  checkIn: string;
  bookedAt: string;
  paid: boolean;
}

const COLUMNS: ExportColumn<Row>[] = [
  { header: 'Guest', value: (row) => row.guest },
  { header: 'Nights', value: (row) => row.nights, type: 'integer' },
  { header: 'Amount', value: (row) => row.amount, type: 'money' },
  { header: 'Occupancy', value: (row) => row.occupancy, type: 'percent' },
  { header: 'Check-in', value: (row) => row.checkIn, type: 'date' },
  { header: 'Booked', value: (row) => row.bookedAt, type: 'datetime' },
  { header: 'Paid', value: (row) => row.paid },
];

const ROWS: Row[] = [
  { guest: 'Asha Rao', nights: 2, amount: 12500.5, occupancy: 72.5, checkIn: '2026-11-19', bookedAt: '2026-11-02T08:30:00', paid: true },
  { guest: '=HYPERLINK("http://evil")', nights: 1, amount: null, occupancy: 0, checkIn: '2026-12-01', bookedAt: '2026-11-03T21:05:00', paid: false },
  { guest: 'Ravi "RK" Iyer, Jr.', nights: 3, amount: 1500, occupancy: 100, checkIn: '2027-01-04', bookedAt: '2026-11-04T00:00:00', paid: true },
];

const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');

describe('prepareTable', () => {
  it('turns values into typed cells, leaving out what does not fit', () => {
    const table = prepareTable<Record<string, unknown>>([
      { header: 'A', value: (row) => row.a as string },
      { header: 'B', value: (row) => row.b as string, type: 'number' },
      { header: 'C', value: (row) => row.c as string, type: 'date' },
    ], [{ a: '  padded  ', b: '1,234.5', c: '2026-02-28' }, { a: '', b: 'n/a', c: 'not a date' }]);

    expect(table.rows[0]).toEqual(['padded', 1234.5, { year: 2026, month: 2, day: 28, hour: 0, minute: 0 }]);
    expect(table.rows[1]).toEqual([null, null, null]);
  });

  it('shows cells the way the app does', () => {
    const table = prepareTable(COLUMNS, ROWS);
    const shown = table.rows[0]!.map((value, index) => displayValue(value, table.columns[index]!));

    expect(shown).toEqual(['Asha Rao', '2', '₹12,500.50', '72.5%', '19 Nov 2026', '2 Nov 2026, 08:30', 'Yes']);
  });
});

describe('totals row', () => {
  const columns: ExportColumn<{ night: string; sold: number; revenue: number }>[] = [
    { header: 'Night', value: (row) => row.night, type: 'date' },
    { header: 'Rooms sold', value: (row) => row.sold, type: 'integer' },
    { header: 'Revenue', value: (row) => row.revenue, type: 'money' },
  ];
  const rows = [{ night: '2026-10-30', sold: 15, revenue: 79500 }, { night: '2026-10-31', sold: 19, revenue: 100000 }];
  const totals = ['Total', 34, 179500];

  it('keeps the label as text in a date column and the figures typed: last CSV line, bold Excel row below the filter, PDF foot', () => {
    const table = prepareTable(columns, rows, totals);
    expect(table.totals).toEqual(['Total', 34, 179500]);
    expect(toCsv(table).split('\r\n').at(-2)).toBe('"Total",34,179500.00');

    const sheet = xml(strFromU8(unzipSync(toXlsx(table, { title: 'Revenue', filters: [], exportedAt: new Date() }))['xl/worksheets/sheet1.xml']!));
    expect(sheet.getElementsByTagName('autoFilter')[0]!.getAttribute('ref')).toBe('A1:C3'); // sorting never moves the totals
    expect(sheet.getElementsByTagName('dimension')[0]!.getAttribute('ref')).toBe('A1:C4');
    const cells = [...sheet.getElementsByTagName('row')[3]!.getElementsByTagName('c')];
    expect(cells.map((cell) => [cell.textContent, cell.getAttribute('s')])).toEqual([['Total', '12'], ['34', '13'], ['179500', '15']]);
    // Rows themselves stay real dates.
    expect(sheet.getElementsByTagName('row')[1]!.getElementsByTagName('c')[0]!.getAttribute('s')).toBe('5');

    const pdf = toPdf(table, { title: 'Revenue', filters: [], exportedAt: new Date() }, null).output();
    expect(pdf.startsWith('%PDF-')).toBe(true);
  });
});

describe('per-row currency', () => {
  const columns: ExportColumn<{ amount: number; currency: string }>[] = [
    { header: 'Amount', value: (row) => row.amount, type: 'money', currency: (row) => row.currency },
  ];
  const rows = [{ amount: 1500, currency: 'INR' }, { amount: 99.5, currency: 'usd' }];

  it('writes each amount in its own currency: in the PDF text, the Excel format and an unlabelled CSV header', () => {
    const table = prepareTable(columns, rows);
    expect(displayValue(table.rows[1]![0]!, table.columns[0]!, 'USD')).toMatch(/^USD\s99\.50$/);
    expect(displayValue(table.rows[0]![0]!, table.columns[0]!, 'INR')).toBe('₹1,500.00');
    expect(toCsv(table).split('\r\n')[0]).toBe('﻿"Amount"');

    const sheet = strFromU8(unzipSync(toXlsx(table, { title: 'Payments', filters: [], exportedAt: new Date() }))['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('<c r="A2" s="4"><v>1500</v></c>'); // ₹
    expect(sheet).toContain('<c r="A3" s="3"><v>99.5</v></c>'); // 2 decimals, no ₹
  });
});

describe('CSV', () => {
  it('writes a UTF-8 BOM, the units in the header, plain numbers and dates, and CRLF lines', () => {
    const csv = toCsv(prepareTable(COLUMNS, ROWS));
    const lines = csv.slice(1).split('\r\n');

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toBe('"Guest","Nights","Amount (INR)","Occupancy (%)","Check-in","Booked","Paid"');
    expect(lines[1]).toBe('"Asha Rao",2,12500.50,72.5,2026-11-19,2026-11-02 08:30,"Yes"');
    expect(lines[3]).toBe('"Ravi ""RK"" Iyer, Jr.",3,1500.00,100,2027-01-04,2026-11-04 00:00,"Yes"');
    expect(lines.at(-1)).toBe('');
  });

  it('never lets a spreadsheet run text as a formula', () => {
    const csv = toCsv(prepareTable(COLUMNS, ROWS));

    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")",1,,0,');
    for (const start of ['+1', '-1', '@SUM(A1)']) {
      expect(toCsv(prepareTable([{ header: 'T', value: () => start }], [{}]))).toContain(`"'${start}"`);
    }
    // Leading tabs and spaces are trimmed first, so they cannot hide a formula.
    expect(toCsv(prepareTable([{ header: 'T', value: () => '\t=1+1' }], [{}]))).toContain(`"'=1+1"`);
  });
});

describe('Excel', () => {
  const info = { title: 'Reservations', subtitle: 'Sea Breeze', filters: [{ label: 'Status', value: 'Confirmed' }], scope: 'All 3 rows',
    exportedBy: 'Rohan Iyer (Hotel manager)', exportedAt: new Date(2026, 10, 9, 10, 24) };

  it('helpers: column letters, Excel dates and safe sheet names', () => {
    expect([0, 25, 26, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
    expect(excelSerial({ year: 2024, month: 1, day: 1, hour: 0, minute: 0 })).toBe(45292);
    expect(excelSerial({ year: 2024, month: 1, day: 1, hour: 12, minute: 0 })).toBe(45292.5);
    expect(sheetName('Payments: refunds / chargebacks [all] of the year 2026')).toBe('Payments refunds chargebacks al');
  });

  it('is a valid package: a data sheet with a frozen, filterable header and typed cells, and an about sheet', () => {
    const files = unzipSync(toXlsx(prepareTable(COLUMNS, ROWS), info));
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]);
    for (const [name, bytes] of Object.entries(files)) {
      expect(xml(strFromU8(bytes)).getElementsByTagName('parsererror'), name).toHaveLength(0);
    }

    const workbook = xml(strFromU8(files['xl/workbook.xml']!));
    expect([...workbook.getElementsByTagName('sheet')].map((sheet) => sheet.getAttribute('name'))).toEqual(['Reservations', 'About this export']);
    expect(workbook.getElementsByTagName('definedName')[0]!.textContent).toBe("'Reservations'!$A$1:$G$4");

    const sheet = xml(strFromU8(files['xl/worksheets/sheet1.xml']!));
    expect(sheet.getElementsByTagName('pane')[0]!.getAttribute('state')).toBe('frozen');
    expect(sheet.getElementsByTagName('autoFilter')[0]!.getAttribute('ref')).toBe('A1:G4');
    const cell = (ref: string) => [...sheet.getElementsByTagName('c')].find((c) => c.getAttribute('r') === ref)!;
    expect(cell('A1').textContent).toBe('Guest');
    expect(cell('A1').getAttribute('s')).toBe('1');
    expect(cell('C1').getAttribute('s')).toBe('9'); // numbers: header aligned right
    expect(cell('A2').getAttribute('t')).toBe('inlineStr');
    expect(cell('B2').textContent).toBe('2');
    expect(cell('C2').textContent).toBe('12500.5');
    expect(cell('C2').getAttribute('s')).toBe('4'); // ₹ format
    expect(cell('D2').textContent).toBe('0.725'); // percent as a fraction
    expect(cell('E2').textContent).toBe(String(excelSerial({ year: 2026, month: 11, day: 19, hour: 0, minute: 0 })));
    expect(cell('E2').getAttribute('s')).toBe('5');
    expect(cell('F2').getAttribute('s')).toBe('6');
    // An empty amount is no cell at all; text that looks like a formula stays text.
    expect([...sheet.getElementsByTagName('c')].some((c) => c.getAttribute('r') === 'C3')).toBe(false);
    expect(cell('A3').getAttribute('t')).toBe('inlineStr');
    expect(sheet.getElementsByTagName('f')).toHaveLength(0);

    expect(strFromU8(files['xl/styles.xml']!)).toContain('formatCode="&quot;₹&quot;#,##0.00"');
    const about = strFromU8(files['xl/worksheets/sheet2.xml']!);
    for (const text of ['Reservations', 'Sea Breeze', '9 Nov 2026, 10:24', 'Rohan Iyer (Hotel manager)', 'All 3 rows', 'Status', 'Confirmed']) {
      expect(about).toContain(text);
    }
  });
});

describe('PDF', () => {
  // Vitest runs from frontend/.
  const font = (name: string) => readFileSync(join(process.cwd(), 'src/lib/export/fonts', name), 'latin1');
  const fonts = { regular: font('Inter-Regular.ttf'), bold: font('Inter-Bold.ttf') };
  const info = { title: 'Reservations', filters: [], exportedAt: new Date(2026, 10, 9, 10, 24) };

  it('is an A4 PDF with Inter embedded, landscape for a wide table, and as many pages as the rows need', () => {
    const many = Array.from({ length: 120 }, (_, index) => ({ ...ROWS[0]!, guest: `Guest ${index}` }));
    const doc = toPdf(prepareTable(COLUMNS, many), info, fonts);
    const pdf = doc.output();

    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain('/FontName /Inter');
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight()); // 7 columns: landscape
    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
  });

  it('a narrow table is portrait; without the font it still works (₹ written as Rs.)', () => {
    const doc = toPdf(prepareTable(COLUMNS.slice(0, 3), ROWS), info, null);

    expect(doc.internal.pageSize.getHeight()).toBeGreaterThan(doc.internal.pageSize.getWidth());
    expect(doc.getNumberOfPages()).toBe(1);
  });
});

describe('createExportFile', () => {
  it('names the file after the export and the day, and refuses a PDF of too many rows', async () => {
    const file = await createExportFile('csv', { title: 'Reservations', fileName: 'Reservations — Sea Breeze Résort', columns: COLUMNS, rows: ROWS,
      exportedAt: new Date(2026, 10, 9) });
    expect(file.fileName).toBe('reservations-sea-breeze-resort-2026-11-09.csv');
    expect(file.blob.type).toBe('text/csv;charset=utf-8');

    const xlsx = await createExportFile('xlsx', { title: 'Reservations', fileName: 'reservations', columns: COLUMNS, rows: ROWS });
    expect(xlsx.blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const many = Array.from({ length: 2001 }, () => ROWS[0]!);
    await expect(createExportFile('pdf', { title: 'Reservations', fileName: 'reservations', columns: COLUMNS, rows: many }))
      .rejects.toThrow('A PDF holds at most 2,000 rows');
  });

  it('describes only the filters that are set', () => {
    expect(describeFilters([['Status', 'Confirmed'], ['Search', ''], ['Room type', null], ['Page size', 25], ['Dates', false]]))
      .toEqual([{ label: 'Status', value: 'Confirmed' }, { label: 'Page size', value: '25' }]);
    expect(slugify('***')).toBe('export');
  });
});

describe('collectAllRows', () => {
  /** A server that clamps the page size to `max`, like the services do. */
  const server = (total: number, max = 100) => vi.fn(async (page: number, size: number): Promise<Page<number>> => {
    const clamped = Math.min(size, max);
    const start = page * clamped;
    return {
      content: Array.from({ length: Math.max(0, Math.min(clamped, total - start)) }, (_, index) => start + index),
      page, size: clamped, totalElements: total, totalPages: Math.ceil(total / clamped),
    };
  });

  it('pages through the list at the size the server allows, reporting progress', async () => {
    const fetchPage = server(120, 50);
    const progress: number[] = [];

    const rows = await collectAllRows(fetchPage, { onProgress: (loaded) => progress.push(loaded) });

    expect(rows).toEqual(Array.from({ length: 120 }, (_, index) => index));
    expect(fetchPage.mock.calls).toEqual([[0, 100], [1, 100], [2, 100]]);
    expect(progress).toEqual([50, 100, 120]);
  });

  it('waits and asks again after 429, and gives up after the last wait', async () => {
    const fetchPage = server(10);
    fetchPage.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'Too many requests.'));
    expect(await collectAllRows(fetchPage, { backoff: [0, 0] })).toHaveLength(10);

    const busy = vi.fn().mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many requests.'));
    await expect(collectAllRows(busy, { backoff: [0, 0] })).rejects.toThrow('Too many requests.');
    expect(busy).toHaveBeenCalledTimes(3);
  });

  it('refuses more rows than the limit before loading them, drops repeated rows, and stops when cancelled', async () => {
    await expect(collectAllRows(server(10_001))).rejects.toBeInstanceOf(ExportTooLargeError);

    const moving = vi.fn(async (page: number): Promise<Page<string>> => ({
      content: page === 0 ? ['a', 'b'] : ['b', 'c'], page, size: 2, totalElements: 4, totalPages: 2,
    }));
    expect(await collectAllRows(moving, { key: (row) => row })).toEqual(['a', 'b', 'c']);

    const controller = new AbortController();
    controller.abort();
    await expect(collectAllRows(server(10), { signal: controller.signal })).rejects.toThrow();
  });
});
