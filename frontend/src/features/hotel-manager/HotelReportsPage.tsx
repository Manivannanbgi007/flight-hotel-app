import { useId, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';
import {
  BarChart3, BedDouble, CalendarCheck2, Crown, Flame, IndianRupee, Percent, Table2, TrendingUp, Users, Wallet, type LucideIcon,
} from 'lucide-react';

import { BarChart, ChartCard, DonutChart, seriesColor } from '@/components/charts';
import { ExportMenu } from '@/components/export/ExportMenu';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { EmptyState, LoadingState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { describeFilters, type ExportCellType, type ExportColumn } from '@/lib/export';
import { formatDate, formatMoney } from '@/lib/format';
import { describeRange, RANGE_LABELS } from './dateRange';
import { DateRangeFilter, HotelPageError, ManagerPageHeader, MetricGrid, MetricTile, Toolbar } from './ManagerParts';
import { NightlyBarChart } from './NightlyBarChart';
import { operationsApi } from './operationsApi';
import type { OccupancyReport, RangeEcho, ReportKind, RevenueReport, RoomTypeReport } from './operationsTypes';
import { describeExtremes, formatCompactMoney, peakRow, valueAxis } from './reportScale';
import { formatCount, formatPercent, useRangeParam } from './reservationStatus';
import { useManagerHotels } from './useManagerHotels';

/** The reports: two per night and the room types of the period; each exports to Excel, CSV or PDF. */
type ReportView = ReportKind | 'room-types';
const REPORTS: { value: ReportView; label: string; icon: LucideIcon }[] = [
  { value: 'occupancy', label: 'Occupancy', icon: Percent },
  { value: 'revenue', label: 'Revenue', icon: IndianRupee },
  { value: 'room-types', label: 'Room types', icon: BedDouble },
];
const money = (value: number) => formatMoney(value);

/**
 * /hotel-manager/hotels/:hotelId/reports?report=occupancy|revenue|room-types&range=… — the report switcher, the period
 * and the export (Excel, CSV or PDF of the table with its totals) in one toolbar; then the period's totals, the chart and the night-by-night (or room type) table
 * with totals. Live: `hotel.reservation-changed`.
 */
export function HotelReportsPage() {
  const { hotelId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useRangeParam();
  const reportParam = params.get('report');
  const report: ReportView = reportParam === 'revenue' || reportParam === 'room-types' ? reportParam : 'occupancy';

  const occupancy = useQuery({
    queryKey: queryKeys.hotelManager.report(hotelId, 'occupancy', { ...range }),
    queryFn: () => operationsApi.occupancyReport(hotelId, range),
    placeholderData: keepPreviousData,
    enabled: report === 'occupancy',
  });
  const revenue = useQuery({
    queryKey: queryKeys.hotelManager.report(hotelId, 'revenue', { ...range }),
    queryFn: () => operationsApi.revenueReport(hotelId, range),
    placeholderData: keepPreviousData,
    enabled: report === 'revenue',
  });
  const roomTypes = useQuery({
    queryKey: queryKeys.hotelManager.report(hotelId, 'room-types', { ...range }),
    queryFn: () => operationsApi.roomTypeReport(hotelId, range),
    placeholderData: keepPreviousData,
    enabled: report === 'room-types',
  });
  const current = report === 'occupancy' ? occupancy : report === 'revenue' ? revenue : roomTypes;
  const shown = current.data?.range ?? null;
  const reportLabelId = useId();
  const hotelName = useManagerHotels().data?.find((hotel) => hotel.id === hotelId)?.name;
  const table = exportTable(report, occupancy.data, revenue.data, roomTypes.data);
  const reportLabel = REPORTS.find((option) => option.value === report)?.label ?? 'Occupancy';

  const chooseReport = (next: ReportView) => {
    const updated = new URLSearchParams(params);
    if (next === 'occupancy') updated.delete('report');
    else updated.set('report', next);
    setParams(updated);
  };

  if (current.isError && ApiError.from(current.error).code === 'HOTEL_NOT_ASSIGNED') {
    return <HotelPageError error={current.error} />;
  }
  return (
    <div className="flex flex-col gap-5">
      <ManagerPageHeader
        icon={<BarChart3 className="size-5" />}
        title="Reports"
        description="Occupancy, room revenue and room type performance for any period, with totals, to export as Excel, CSV or PDF. Weekly, monthly and yearly trends are on the dashboard."
        actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>}
      />

      <Toolbar>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span id={reportLabelId} className="text-sm font-semibold text-slate-800">Report</span>
            <div role="group" aria-labelledby={reportLabelId}
              className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100/80 p-1 ring-1 ring-inset ring-slate-200/70 [scrollbar-width:none]">
              {REPORTS.map(({ value, label, icon: Icon }) => (
                <button key={value} type="button" aria-pressed={report === value} onClick={() => chooseReport(value)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors duration-(--duration-fast) sm:px-3.5',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-600',
                    report === value ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
                  )}>
                  <Icon className="hidden size-4 sm:block" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* At least 16rem: next to the switcher when there is room, on a row of its own on phones. */}
          <div className="min-w-64 flex-1">
            <DateRangeFilter key={JSON.stringify(range)} value={range} onChange={setRange} shown={shown} />
          </div>
          <ExportMenu
            className="sm:mt-7"
            title={`${reportLabel} report`}
            subtitle={[hotelName, shown && describeRange(shown)].filter(Boolean).join(' · ') || undefined}
            fileName={`${report}-report-${hotelName ?? hotelId}${shown ? `-${shown.from}-${shown.to}` : ''}`}
            columns={table.columns}
            rows={table.rows}
            totals={table.totals}
            filters={describeFilters([
              ['Report', reportLabel],
              ['Period', `${RANGE_LABELS[range.range]}${shown ? ` (${describeRange(shown)})` : ''}`],
            ])}
          />
        </div>
      </Toolbar>

      {current.isPending && <LoadingState label="Loading the report…" />}
      {current.isError && <HotelPageError error={current.error} onRetry={() => void current.refetch()} />}
      {report === 'occupancy' && occupancy.data && <OccupancyView report={occupancy.data} />}
      {report === 'revenue' && revenue.data && <RevenueView report={revenue.data} />}
      {report === 'room-types' && roomTypes.data && <RoomTypesView report={roomTypes.data} />}
    </div>
  );
}

const periodText = (range: RangeEcho | null) => (range ? `, ${describeRange(range)}` : '');

/** A white card for a chart. */
function ChartPanel({ children }: { children: ReactNode }) {
  return <section className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card animate-fade-up">{children}</section>;
}

function OccupancyView({ report }: { report: OccupancyReport }) {
  if (report.rows.length === 0) {
    return <EmptyState title="No nights in this period" />;
  }
  const axis = { max: 100, ticks: [0, 25, 50, 75, 100] };
  const percentOf = (value: number) => formatPercent(value);
  const peak = peakRow(report.rows, (row) => row.occupancyPercent);
  const busiest = peak && peak.occupancyPercent > 0 ? peak : undefined;
  const nights = report.rows.length;
  return (
    <>
      <MetricGrid label="Occupancy totals">
        <MetricTile label="Occupancy" value={report.totals.occupancyPercent} format={formatPercent} icon={<Percent className="size-5" />}
          hint={`Rooms sold of the rooms for sale, ${nights} night${nights === 1 ? '' : 's'}`} />
        <MetricTile label="Room nights for sale" value={report.totals.roomNights} format={formatCount} icon={<BedDouble className="size-5" />}
          hint="Rooms on sale, added up over the nights" />
        <MetricTile label="Room nights sold" value={report.totals.bookedRoomNights} format={formatCount} icon={<CalendarCheck2 className="size-5" />}
          hint="Rooms booked on those nights" />
        <MetricTile label="Busiest night" value={busiest ? formatPercent(busiest.occupancyPercent) : '—'} icon={<Flame className="size-5" />}
          hint={busiest ? formatDate(busiest.date) : 'No rooms sold in this period'} />
      </MetricGrid>
      <ChartPanel>
        <NightlyBarChart
          title="Occupancy per night"
          description="Share of the rooms for sale that were booked, night by night"
          bars={report.rows.map((row) => ({ date: row.date, value: row.occupancyPercent, label: percentOf(row.occupancyPercent) }))}
          max={axis.max}
          ticks={axis.ticks}
          formatTick={(tick) => `${tick}%`}
          reference={{ value: report.totals.occupancyPercent, label: `Overall ${formatPercent(report.totals.occupancyPercent)}` }}
          summary={`Occupancy per night${periodText(report.range)}. Overall ${formatPercent(report.totals.occupancyPercent)}. ${describeExtremes(
            report.rows, (row) => row.occupancyPercent, (row) => percentOf(row.occupancyPercent))} The table below lists every night.`}
        />
      </ChartPanel>
      <ReportTable title="Night by night" description="Rooms for sale, rooms sold and the occupancy of every night of the period"
        caption="Occupancy per night" headers={['Night', 'Rooms for sale', 'Rooms sold', 'Occupancy']}
        rows={report.rows.map((row) => [formatDate(row.date), formatCount(row.roomNights), formatCount(row.bookedRoomNights), formatPercent(row.occupancyPercent)])}
        meters={report.rows.map((row) => row.occupancyPercent)}
        totals={['Total', formatCount(report.totals.roomNights), formatCount(report.totals.bookedRoomNights), formatPercent(report.totals.occupancyPercent)]} />
    </>
  );
}

function RevenueView({ report }: { report: RevenueReport }) {
  if (report.rows.length === 0) {
    return <EmptyState title="No nights in this period" />;
  }
  const axis = valueAxis(Math.max(...report.rows.map((row) => row.revenue)));
  const peak = peakRow(report.rows, (row) => row.revenue);
  const best = peak && peak.revenue > 0 ? peak : undefined;
  const average = report.totals.revenue / report.rows.length;
  return (
    <>
      <MetricGrid label="Revenue totals">
        <MetricTile label="Room revenue" value={report.totals.revenue} format={money} icon={<Wallet className="size-5" />}
          hint="Room charges without GST" />
        <MetricTile label="Room nights sold" value={report.totals.roomNights} format={formatCount} icon={<CalendarCheck2 className="size-5" />}
          hint="Rooms sold, added up over the nights" />
        <MetricTile label="Average daily rate" value={report.totals.averageDailyRate} format={money} icon={<TrendingUp className="size-5" />}
          hint="Revenue per room night sold" />
        <MetricTile label="Best night" value={best ? formatMoney(best.revenue) : '—'} icon={<Flame className="size-5" />}
          hint={best ? formatDate(best.date) : 'No room revenue in this period'} />
      </MetricGrid>
      <ChartPanel>
        <NightlyBarChart
          title="Room revenue per night"
          description="Room charges without GST, spread over the nights of each stay"
          bars={report.rows.map((row) => ({ date: row.date, value: row.revenue, label: formatMoney(row.revenue) }))}
          max={axis.max}
          ticks={axis.ticks}
          formatTick={formatCompactMoney}
          reference={{ value: average, label: `Average ${formatCompactMoney(average)} a night` }}
          summary={`Room revenue per night${periodText(report.range)}. Total ${formatMoney(report.totals.revenue)}. ${describeExtremes(
            report.rows, (row) => row.revenue, (row) => formatMoney(row.revenue))} The table below lists every night.`}
        />
      </ChartPanel>
      <ReportTable title="Night by night" description="Room nights sold, revenue and the average daily rate of every night"
        caption="Room revenue per night" headers={['Night', 'Room nights sold', 'Revenue', 'Average daily rate']}
        rows={report.rows.map((row) => [formatDate(row.date), formatCount(row.roomNights), formatMoney(row.revenue), formatMoney(row.averageDailyRate)])}
        totals={['Total', formatCount(report.totals.roomNights), formatMoney(report.totals.revenue), formatMoney(report.totals.averageDailyRate)]} />
    </>
  );
}

/**
 * The chart's numbers as a table in a titled card: the first column is the night (or room type), the others are
 * right-aligned figures; `meters` (0–100 per row) draws a small bar next to the last column. Header and totals stick
 * while the rows scroll.
 */
function ReportTable({ title, description, caption, headers, rows, totals, meters }: {
  title: string;
  description: string;
  caption: string;
  headers: string[];
  rows: string[][];
  totals: string[];
  meters?: number[];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card animate-fade-up">
      <div className="flex items-start gap-3 px-5 py-4">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-role-50 text-role-600 ring-1 ring-inset ring-role-100">
          <Table2 className="size-[1.125rem]" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        </div>
      </div>
      <div className="max-h-[30rem] overflow-auto border-t border-slate-200/80">
        <table className="min-w-full text-sm tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10">
            <tr>
              {headers.map((header, index) => (
                <th key={header} scope="col"
                  className={cn(tableStyles.headSurface, tableStyles.headType, 'whitespace-nowrap px-5 py-2.5 text-role-800', index === 0 ? 'text-left' : 'text-right')}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={tableStyles.tbody}>
            {rows.map(([night, ...figures], rowIndex) => (
              <tr key={night} className={tableStyles.tr}>
                <th scope="row" className="whitespace-nowrap px-5 py-2 text-left font-medium text-slate-700">{night}</th>
                {figures.map((figure, index) => {
                  const meter = meters && index === figures.length - 1 ? meters[rowIndex] : undefined;
                  return (
                    <td key={index} className="whitespace-nowrap px-5 py-2 text-right text-slate-900">
                      {meter === undefined ? figure : (
                        <span className="inline-flex items-center justify-end gap-3">
                          <span aria-hidden="true" className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 sm:block">
                            <span className="block h-full rounded-full bg-role-500" style={{ width: `${Math.min(Math.max(meter, 0), 100)}%` }} />
                          </span>
                          <span className="w-12">{figure}</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
            <tr>
              <th scope="row" className="px-5 py-2.5 text-left">{totals[0]}</th>
              {totals.slice(1).map((total, index) => <td key={index} className="whitespace-nowrap px-5 py-2.5 text-right">{total}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** Room type performance: how much each room type sold and earned in the period, as figures, charts and a table. */
function RoomTypesView({ report }: { report: RoomTypeReport }) {
  if (report.rows.length === 0 || report.roomNights === 0) {
    return <EmptyState title="No room nights sold in this period" description="Room type figures appear once guests have stayed." />;
  }
  const top = peakRow(report.rows, (row) => row.revenue);
  const stays = report.rows.reduce((sum, row) => sum + row.stays, 0);
  return (
    <>
      <MetricGrid label="Room type totals">
        <MetricTile label="Room revenue" value={report.revenue} format={money} icon={<Wallet className="size-5" />}
          hint="Room charges without GST" />
        <MetricTile label="Room nights sold" value={report.roomNights} format={formatCount} icon={<CalendarCheck2 className="size-5" />}
          hint={`Average daily rate ${formatMoney(report.revenue / report.roomNights)}`} />
        <MetricTile label="Stays" value={stays} format={formatCount} icon={<Users className="size-5" />}
          hint="Reservations with nights in the period" />
        <MetricTile label="Top room type" value={top?.name ?? '—'} icon={<Crown className="size-5" />}
          hint={top ? `${formatPercent(top.revenueShare)} of the revenue` : undefined} />
      </MetricGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard as="h3" title="Revenue by room type" description="Room charges without GST, for the stays of the period">
          <BarChart title="Revenue by room type" data={report.rows} xKey="name" xLabel="Room type" valueFormat="inr"
            series={[{ key: 'revenue', label: 'Revenue', color: seriesColor(1) }]} emptyMessage="No room revenue in this period" />
        </ChartCard>
        <ChartCard as="h3" title="Room nights by room type" description="Share of the room nights sold">
          <DonutChart title="Room nights by room type" valueFormat="count" centerLabel="Room nights"
            data={report.rows.map((row) => ({ label: row.name, value: row.roomNights }))} emptyMessage="No room nights sold" />
        </ChartCard>
      </div>
      <ReportTable title="Room type performance" description="Stays, room nights, revenue and the share of the revenue of each room type"
        caption="Room type performance" headers={['Room type', 'Stays', 'Room nights sold', 'Revenue', 'Average daily rate', 'Share of revenue']}
        rows={report.rows.map((row) => [row.name, formatCount(row.stays), formatCount(row.roomNights), formatMoney(row.revenue), formatMoney(row.averageDailyRate), formatPercent(row.revenueShare)])}
        meters={report.rows.map((row) => row.revenueShare)}
        totals={['Total', formatCount(stays), formatCount(report.roomNights), formatMoney(report.revenue),
          formatMoney(report.roomNights === 0 ? 0 : report.revenue / report.roomNights), '']} />
    </>
  );
}

/** A row of an exported report: the night (or room type) as written in the table, then its figures. */
type ExportRow = Record<string, string | number | null>;

const column = (header: string, key: string, type: ExportCellType = 'text'): ExportColumn<ExportRow> =>
  ({ header, value: (row) => row[key], type });

/**
 * The shown report as the export's columns, rows and totals row, so the file matches the table with its Total row. The
 * night is a real date (Excel sorts and filters it); the totals row stays below the rows. No rows while the report
 * loads or has nothing to show (the Export button is then disabled).
 */
function exportTable(report: ReportView, occupancy?: OccupancyReport, revenue?: RevenueReport, roomTypes?: RoomTypeReport) {
  if (report === 'occupancy') {
    const columns = [column('Night', 'night', 'date'), column('Rooms for sale', 'forSale', 'integer'), column('Rooms sold', 'sold', 'integer'),
      column('Occupancy', 'occupancy', 'percent')];
    if (!occupancy || occupancy.rows.length === 0) return { columns, rows: [] as ExportRow[] };
    return {
      columns,
      rows: occupancy.rows.map((row) => ({ night: row.date, forSale: row.roomNights, sold: row.bookedRoomNights, occupancy: row.occupancyPercent })),
      totals: ['Total', occupancy.totals.roomNights, occupancy.totals.bookedRoomNights, occupancy.totals.occupancyPercent],
    };
  }
  if (report === 'revenue') {
    const columns = [column('Night', 'night', 'date'), column('Room nights sold', 'sold', 'integer'), column('Revenue', 'revenue', 'money'),
      column('Average daily rate', 'adr', 'money')];
    if (!revenue || revenue.rows.length === 0) return { columns, rows: [] as ExportRow[] };
    return {
      columns,
      rows: revenue.rows.map((row) => ({ night: row.date, sold: row.roomNights, revenue: row.revenue, adr: row.averageDailyRate })),
      totals: ['Total', revenue.totals.roomNights, revenue.totals.revenue, revenue.totals.averageDailyRate],
    };
  }
  const columns = [column('Room type', 'name'), column('Stays', 'stays', 'integer'), column('Room nights sold', 'sold', 'integer'),
    column('Revenue', 'revenue', 'money'), column('Average daily rate', 'adr', 'money'), column('Share of revenue', 'share', 'percent')];
  if (!roomTypes || roomTypes.rows.length === 0 || roomTypes.roomNights === 0) return { columns, rows: [] as ExportRow[] };
  return {
    columns,
    rows: roomTypes.rows.map((row) => ({
      name: row.name, stays: row.stays, sold: row.roomNights, revenue: row.revenue, adr: row.averageDailyRate, share: row.revenueShare,
    })),
    totals: ['Total', roomTypes.rows.reduce((sum, row) => sum + row.stays, 0), roomTypes.roomNights, roomTypes.revenue,
      roomTypes.revenue / roomTypes.roomNights, null],
  };
}
