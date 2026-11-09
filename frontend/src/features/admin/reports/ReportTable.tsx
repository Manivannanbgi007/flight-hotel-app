import { Link } from 'react-router';

import { tableStyles } from '@/components/ui/dataTableStyles';
import { cn } from '@/lib/cn';
import { SortHeader, TableShell, tdClass } from '../shared/adminUi';
import type { SortState } from '../shared/searchState';
import type { ReportColumn, ReportRow } from './reportApi';
import { cellLink, formatCell, isNumeric, totalLabel } from './reports';

interface ReportTableProps {
  caption: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Over every row of the range and filters. */
  totals: Record<string, unknown>;
  /** Column keys that can be sorted. */
  sortable: string[];
  sort: SortState | null;
  onSort: (sort: SortState) => void;
}

/**
 * A report as a table, driven by its `columns` (format by type: money, number, date, ...). Sortable columns have a
 * header button; the last row holds the totals, and totals without a column (e.g. the row count) are listed under it.
 */
export function ReportTable({ caption, columns, rows, totals, sortable, sort, onSort }: ReportTableProps) {
  const columnKeys = new Set(columns.map((column) => column.key));
  const columnTotals = columns.some((column) => totals[column.key] !== undefined);
  const otherTotals = Object.entries(totals).filter(([key]) => !columnKeys.has(key));

  return (
    <div className="flex flex-col gap-2">
      {/* Most reports have 7 to 11 columns, wider than the card on a 1280 px screen: scrolls, no sticky header. */}
      <TableShell caption={caption} scroll>
        <thead>
          <tr>
            {columns.map((column) => {
              const align = isNumeric(column.type) ? 'right' : 'left';
              return sortable.includes(column.key)
                ? <SortHeader key={column.key} label={column.label} field={column.key} sort={sort} onSort={onSort} align={align} />
                : <th key={column.key} scope="col" className={cn(tableStyles.th, align === 'right' && 'text-right')}>{column.label}</th>;
            })}
          </tr>
        </thead>
        <tbody className={tableStyles.tbody}>
          {rows.map((row, index) => (
            <tr key={index} className={tableStyles.tr}>
              {columns.map((column) => {
                const link = cellLink(column.key, row);
                const text = formatCell(row[column.key], column.type);
                return (
                  <td key={column.key} className={cn(tdClass, isNumeric(column.type) && 'whitespace-nowrap text-right',
                    (column.type === 'DATE' || column.type === 'DATETIME') && 'whitespace-nowrap')}>
                    {link && text !== '—' ? <Link to={link} className="font-medium text-role-700 hover:underline">{text}</Link> : text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {columnTotals && (
          <tfoot className="border-t-2 border-slate-200 font-semibold text-slate-900 [&>tr>*]:bg-slate-50">
            <tr>
              {columns.map((column, index) => {
                const value = totals[column.key];
                if (index === 0 && value === undefined) {
                  return <th key={column.key} scope="row" className={tdClass}>Total</th>;
                }
                return (
                  <td key={column.key} className={cn(tdClass, isNumeric(column.type) && 'whitespace-nowrap text-right')}>
                    {value === undefined ? '' : formatCell(value, column.type)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </TableShell>
      {otherTotals.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700" aria-label="Totals">
          {otherTotals.map(([key, value]) => (
            <div key={key} className="flex gap-1">
              <dt>{totalLabel(key)}:</dt>
              <dd className="font-semibold text-slate-900">{formatCell(value, 'NUMBER')}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
