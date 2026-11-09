import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { BarChart3 } from 'lucide-react';

import { ExportMenu } from '@/components/export/ExportMenu';
import { SelectField } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { EmptyState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { describeFilters, type ExportCellType, type ExportColumn, type ExportValue } from '@/lib/export';
import {
  FilterCard, ListLoading, LoadError, PageHeader, RequirePermission, ResultCount, SearchBox,
} from '../shared/adminUi';
import { DateRangePicker } from '../shared/DateRangePicker';
import { presetLabel, rangeDays, rangeQuery, rangeSearchParams, readRange } from '../shared/dateRange';
import { readEnum, readPage, readSort, sortParam, useSearchState, type SortState } from '../shared/searchState';
import { reportApi, type ColumnType, type OccupancyResult, type ReportColumn, type ReportQuery, type ReportResult, type ReportRow } from './reportApi';
import { findReport, occupancyReport, type ReportDefinition } from './reports';
import { ReportTable } from './ReportTable';

const EXPORT_TYPES: Record<ColumnType, ExportCellType> = {
  TEXT: 'text', MONEY: 'money', NUMBER: 'number', DATE: 'date', DATETIME: 'datetime', PERCENT: 'percent',
};

/**
 * A report's columns for an export (CSV, Excel, PDF), typed by the report's own column types. A NUMBER column whose
 * values are all whole numbers (room nights, counts) is written as a whole number.
 */
function reportExportColumns(columns: ReportColumn[], rows: ReportRow[]): ExportColumn<ReportRow>[] {
  return columns.map((column) => {
    const whole = column.type === 'NUMBER' && rows.every((row) => {
      const value = row[column.key];
      return value === null || value === undefined || Number.isInteger(Number(value));
    });
    return {
      header: column.label,
      type: whole ? 'integer' : EXPORT_TYPES[column.type] ?? 'text',
      value: (row: ReportRow) => {
        const value = row[column.key];
        if (value === null || value === undefined) return null;
        if (column.type === 'DATE' && typeof value === 'string') return value.slice(0, 10);
        return typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
      },
    };
  });
}

/**
 * The report's totals as the export's totals row, one value per column like the table's foot: "Total" in the first
 * column when it has no total of its own. None when the report has no column totals.
 */
function reportTotals(columns: ReportColumn[], totals: Record<string, unknown>): ExportValue[] | undefined {
  if (!columns.some((column) => totals[column.key] !== undefined)) return undefined;
  return columns.map((column, index) => {
    const value = totals[column.key];
    if (value === undefined || value === null) return index === 0 ? 'Total' : null;
    return typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
  });
}

/** "Occupancy, highest first" for the file: the sorted column and the direction. */
function sortLabel(columns: ReportColumn[], sort: SortState | null): string | null {
  if (!sort) return null;
  const label = columns.find((column) => column.key === sort.field)?.label ?? sort.field;
  return `${label}, ${sort.direction === 'asc' ? 'ascending' : 'descending'}`;
}

/**
 * /admin/reports/:report — one report: date range, search, filters, sortable columns, totals and the Export menu (CSV,
 * Excel, PDF) like every table: this page, or every matching row through the same report API (the same filters, search
 * and sort, at most 10,000 rows), with the report's totals row when the file holds every row. The hotel occupancy is
 * searched and sorted in the browser and exports what the screen shows.
 */
export function AdminReportPage() {
  const { report } = useParams();
  const definition = findReport(report);
  return (
    <RequirePermission permission="REPORT_VIEW">
      <div className="flex flex-col gap-4">
        <p className="text-sm"><Link to="/admin/reports" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-semibold text-role-700 shadow-xs ring-1 ring-slate-200 transition-colors hover:bg-role-50">← Reports</Link></p>
        {definition
          ? <Report key={definition.key} definition={definition} />
          : <EmptyState title="This report does not exist" description="Pick one from the list of reports." />}
      </div>
    </RequirePermission>
  );
}

/** The server's report, or the hotel occupancy list (searched, sorted and paged here). */
function useReport(definition: ReportDefinition, query: ReportQuery, size: number) {
  const occupancy = definition.key === 'occupancy';
  const { range, ...rest } = query;
  const server = useQuery({
    queryKey: [...queryKeys.admin.report(definition.key, { ...rangeQuery(range), ...rest }), size],
    queryFn: () => reportApi.get(definition.key, query, size),
    enabled: !occupancy,
    placeholderData: keepPreviousData,
  });
  const hotels = useQuery({
    queryKey: queryKeys.admin.report('occupancy', rangeQuery(range)),
    queryFn: () => reportApi.occupancy(range),
    enabled: occupancy,
    placeholderData: keepPreviousData,
  });
  if (!occupancy) {
    return server;
  }
  const data: ReportResult | undefined = hotels.data ? occupancyReport(hotels.data, { ...query, size }) : undefined;
  return { ...hotels, data };
}

function Report({ definition }: { definition: ReportDefinition }) {
  const { params, update } = useSearchState();
  const range = readRange(params);
  const sort = readSort(params, definition.sorts);
  const query: ReportQuery = {
    range,
    q: definition.search ? params.get('q')?.trim() ?? '' : '',
    type: definition.type ? readEnum(params, 'type', definition.type.map((option) => option.value)) : '',
    status: definition.status ? readEnum(params, 'status', definition.status.map((option) => option.value)) : '',
    sort: sortParam(sort) ?? '',
    page: readPage(params),
  };
  const size = readPageSize(params, PAGE_SIZES, 25);
  const report = useReport(definition, query, size);
  const data = report.data;
  const occupancy = definition.key === 'occupancy';
  const queryClient = useQueryClient();
  /** A page of the occupancy list with the same search and sort: from the list already loaded (one request per range). */
  const occupancyPage = async (page: number, pageSize: number) => {
    const source = queryClient.getQueryData<OccupancyResult>(queryKeys.admin.report('occupancy', rangeQuery(range)))
      ?? await reportApi.occupancy(range);
    return occupancyReport(source, { q: query.q, sort: query.sort, page, size: pageSize });
  };

  /** A page of a server report with the same range, search, filters and sort. */
  const serverPage = (page: number, pageSize: number) => reportApi.get(definition.key, { ...query, page }, pageSize);

  return (
    <>
      <PageHeader icon={<BarChart3 className="size-5" />}
        title={definition.title}
        description={data?.range ? `${definition.description} ${rangeDays(data.range)} (India time).` : `${definition.description} ${presetLabel(range.preset)}.`}
      />

      <FilterCard>
        <DateRangePicker key={`${range.preset}-${range.from}-${range.to}`} value={range} onChange={(next) => update(rangeSearchParams(next))} />
        {(definition.search || definition.type || definition.status) && (
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr] sm:items-end">
            {definition.search
              ? <SearchBox key={query.q} initial={query.q} label="Search" placeholder={definition.search} onSearch={(q) => update({ q })} />
              : <span />}
            {definition.type && (
              <SelectField label="Type" value={query.type} onChange={(event) => update({ type: event.target.value })}>
                <option value="">All types</option>
                {definition.type.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </SelectField>
            )}
            {definition.status && (
              <SelectField label="Status" value={query.status} onChange={(event) => update({ status: event.target.value })}>
                <option value="">All statuses</option>
                {definition.status.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </SelectField>
            )}
          </div>
        )}
      </FilterCard>

      {report.isPending && <ListLoading label="Loading the report…" />}
      {report.isError && !data && (
        <LoadError error={report.error} onRetry={() => void report.refetch()}
          title={ApiError.from(report.error).status === 404 ? 'This report does not exist' : undefined} />
      )}
      {data && data.content.length === 0 && <EmptyState illustration="search" title="Nothing in this range" description="Try another date range or fewer filters." />}
      {data && data.content.length > 0 && (
        <div className="flex flex-col gap-3" aria-busy={report.isPlaceholderData || undefined}>
          <div className="flex flex-wrap items-center gap-2">
            <ResultCount count={data.totalElements} noun={['row', 'rows']} />
            <ExportMenu
              className="ml-auto"
              title={occupancy ? definition.title : `${definition.title} report`}
              subtitle={data.range ? `Admin portal · ${rangeDays(data.range)}` : 'Admin portal'}
              fileName={`${occupancy ? 'hotel-occupancy' : `${definition.key}-report`}${data.range ? `-${data.range.from}-${data.range.to}` : ''}`}
              columns={reportExportColumns(data.columns, data.content)}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={occupancy ? occupancyPage : serverPage}
              rowKey={occupancy ? (row) => String(row.hotelId) : undefined}
              totals={reportTotals(data.columns, data.totals)}
              filters={describeFilters([
                ['Dates', data.range ? rangeDays(data.range) : presetLabel(range.preset)],
                ['Search', query.q],
                ['Type', definition.type?.find((option) => option.value === query.type)?.label],
                ['Status', definition.status?.find((option) => option.value === query.status)?.label],
                ['Sort', sortLabel(data.columns, sort)],
              ])}
              personalData={definition.key === 'customers' || definition.key === 'bookings'}
            />
          </div>
          <ReportTable
            caption={`${definition.title} report`}
            columns={data.columns}
            rows={data.content}
            totals={data.totals}
            sortable={definition.sorts}
            sort={sort}
            onSort={(next) => update({ sort: sortParam(next) })}
          />
          <Pagination data={data} noun={['row', 'rows']} pageSizes={PAGE_SIZES}
            onPageChange={(page) => update({ page: String(page) })} onPageSizeChange={(next) => update({ size: next === 25 ? null : String(next) })} />
        </div>
      )}
    </>
  );
}
