import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { BedDouble, Luggage, Plane } from 'lucide-react';

import { ExportMenu } from '@/components/export/ExportMenu';
import { Badge } from '@/components/ui/Badge';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { DateField } from '@/components/ui/DateField';
import { CheckboxField, SelectField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { EmptyState } from '@/components/ui/StateViews';
import { BookingStatusBadge } from '@/features/bookings/BookingParts';
import { bookingPaymentStatusInfo, statusInfo, statusLabel } from '@/features/bookings/status';
import type { BookingStatus } from '@/features/bookings/types';
import { attentionLabel } from '@/features/support/attention';
import { queryKeys } from '@/lib/api/queryKeys';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import {
  FilterCard, ListLoading, LoadError, PageHeader, RequirePermission, ResultCount, SearchBox, SortHeader, TableShell, tdClass,
} from '../shared/adminUi';
import { readDate, readEnum, readPage, readSort, sortParam, useSearchState } from '../shared/searchState';
import { adminBookingApi, type AdminBookingFilters, type AdminBookingRow } from './adminBookingApi';

const STATUSES = Object.keys(statusInfo) as BookingStatus[];
const SORTS = ['createdAt', 'totalAmount', 'startDate'] as const;
const SORT_LABELS: Record<(typeof SORTS)[number], [string, string, string]> = {
  createdAt: ['Booked', 'newest first', 'oldest first'],
  totalAmount: ['Amount', 'highest first', 'lowest first'],
  startDate: ['Travel', 'latest first', 'earliest first'],
};

/** The columns of an export (CSV, Excel, PDF): what the table shows, one figure per column. */
const EXPORT_COLUMNS: ExportColumn<AdminBookingRow>[] = [
  { header: 'Reference', value: (row) => row.reference },
  { header: 'Type', value: (row) => (row.type === 'FLIGHT' ? 'Flight' : 'Hotel') },
  { header: 'Demo', value: (row) => row.demo },
  { header: 'Needs attention', value: (row) => (row.attentionReason ? attentionLabel(row.attentionReason) : null) },
  { header: 'Customer', value: (row) => row.leadName },
  { header: 'E-mail', value: (row) => row.contactEmail },
  { header: 'Trip', value: (row) => row.title },
  { header: 'Destination', value: (row) => row.destination },
  { header: 'Travel from', value: (row) => row.startDate, type: 'date' },
  { header: 'Travel until', value: (row) => row.endDate, type: 'date' },
  { header: 'Status', value: (row) => statusLabel(row.status, row.type, row.paymentStatus) },
  { header: 'Payment', value: (row) => bookingPaymentStatusInfo[row.paymentStatus]?.label ?? row.paymentStatus },
  { header: 'Amount', value: (row) => row.totalAmount, type: 'money', currency: (row) => row.currency },
  { header: 'Refunded', value: (row) => row.refundedAmount, type: 'money', currency: (row) => row.currency },
  { header: 'Currency', value: (row) => row.currency },
  { header: 'Booked', value: (row) => row.createdAt, type: 'datetime' },
];

/** /admin/bookings — every booking: search, filters (status, type, creation dates, attention), sorting and paging. */
export function AdminBookingsPage() {
  return (
    <RequirePermission permission="BOOKING_READ_ANY">
      <Bookings />
    </RequirePermission>
  );
}

function Bookings() {
  const { params, update } = useSearchState();
  const sort = readSort(params, SORTS);
  const filters: AdminBookingFilters = {
    q: params.get('q')?.trim() ?? '',
    status: readEnum(params, 'status', STATUSES),
    type: readEnum(params, 'type', ['HOTEL', 'FLIGHT'] as const),
    from: readDate(params, 'from'),
    to: readDate(params, 'to'),
    attention: params.get('attention') === 'true',
    page: readPage(params),
    sort: sortParam(sort),
  };
  const size = readPageSize(params, PAGE_SIZES, 25);
  const bookings = useQuery({
    queryKey: [...queryKeys.admin.bookingList(filters), size],
    queryFn: () => adminBookingApi.list(filters, size),
    placeholderData: keepPreviousData,
  });
  const data = bookings.data;
  const onSort = (next: Parameters<typeof sortParam>[0]) => update({ sort: sortParam(next) });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={<Luggage className="size-5" />} title="Bookings" description="Every flight and hotel booking. Open one to see everything and to act on it." actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>} />
      <FilterCard>
        <SearchBox key={filters.q} initial={filters.q} label="Search" placeholder="HT-7K3M9Q2X or asha@example.com"
          hint="Booking reference, e-mail, PNR or hotel confirmation number (exact match)." onSearch={(q) => update({ q })} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </SelectField>
          <SelectField label="Type" value={filters.type} onChange={(event) => update({ type: event.target.value })}>
            <option value="">Hotels and flights</option>
            <option value="HOTEL">Hotels</option>
            <option value="FLIGHT">Flights</option>
          </SelectField>
          <DateField label="Booked from" value={filters.from} max={filters.to || undefined} rangeEnd={filters.to}
            onChange={(from) => update({ from })} />
          <DateField label="Booked until" value={filters.to} min={filters.from || undefined} rangeStart={filters.from}
            onChange={(to) => update({ to })} />
        </div>
        <CheckboxField label="Needs attention only" checked={filters.attention}
          onChange={(event) => update({ attention: event.target.checked ? 'true' : null })} />
      </FilterCard>

      {bookings.isPending && <ListLoading label="Loading bookings…" />}
      {bookings.isError && <LoadError error={bookings.error} onRetry={() => void bookings.refetch()} />}
      {data && data.content.length === 0 && <EmptyState title="No bookings found" />}
      {data && data.content.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><ResultCount count={data.totalElements} noun={['booking', 'bookings']} /></div>
            <ExportMenu
              className="ml-auto"
              title="Bookings"
              subtitle="Admin portal"
              fileName="bookings"
              columns={EXPORT_COLUMNS}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={(page, pageSize) => adminBookingApi.list({ ...filters, page }, pageSize)}
              rowKey={(row) => row.id}
              filters={describeFilters([
                ['Search', filters.q],
                ['Status', filters.status && statusLabel(filters.status)],
                ['Type', filters.type && (filters.type === 'HOTEL' ? 'Hotels' : 'Flights')],
                ['Booked from', filters.from && formatDate(filters.from)],
                ['Booked until', filters.to && formatDate(filters.to)],
                ['Needs attention only', filters.attention && 'Yes'],
                ['Sort', sort && sortText(sort)],
              ])}
              personalData
            />
          </div>
          <TableShell caption="Bookings">
            <thead>
              <tr>
                <th scope="col" className={tableStyles.th}>Reference</th>
                <th scope="col" className={tableStyles.th}>Customer</th>
                <th scope="col" className={tableStyles.th}>Trip</th>
                <SortHeader label="Travel" field="startDate" sort={sort} onSort={onSort} />
                <th scope="col" className={tableStyles.th}>Status</th>
                <SortHeader label="Amount" field="totalAmount" sort={sort} onSort={onSort} align="right" />
                <SortHeader label="Booked" field="createdAt" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody className={tableStyles.tbody}>
              {data.content.map((row) => <BookingRow key={row.id} row={row} />)}
            </tbody>
          </TableShell>
          <Pagination data={data} noun={['booking', 'bookings']} pageSizes={PAGE_SIZES}
            onPageChange={(page) => update({ page: String(page) })} onPageSizeChange={(next) => update({ size: next === 25 ? null : String(next) })} />
        </>
      )}
    </div>
  );
}

/** "Amount, highest first": the sort in force, for the exported file. */
function sortText(sort: NonNullable<ReturnType<typeof readSort>>): string {
  const [label, descending, ascending] = SORT_LABELS[sort.field as (typeof SORTS)[number]];
  return `${label}, ${sort.direction === 'desc' ? descending : ascending}`;
}

function BookingRow({ row }: { row: AdminBookingRow }) {
  const payment = bookingPaymentStatusInfo[row.paymentStatus];
  return (
    <tr className={tableStyles.tr}>
      <td className={`${tdClass} whitespace-nowrap`}>
        <Link to={`/admin/bookings/${row.id}`} className="font-medium text-role-700 hover:underline">{row.reference}</Link>
        <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
          {row.type === 'FLIGHT' ? <Plane className="size-3.5" aria-hidden="true" /> : <BedDouble className="size-3.5" aria-hidden="true" />}
          {row.type === 'FLIGHT' ? 'Flight' : 'Hotel'}{row.demo ? ' · demo' : ''}
        </span>
        {row.attentionReason && <Badge tone="danger" className="mt-1">{attentionLabel(row.attentionReason)}</Badge>}
      </td>
      <td className={tdClass}>
        {row.leadName && <span className="block font-medium text-slate-900">{row.leadName}</span>}
        <span className="block break-all text-slate-600">{row.contactEmail}</span>
      </td>
      <td className={tdClass}>
        <span className="block text-slate-900">{row.title ?? '—'}</span>
        {row.destination && <span className="block text-xs text-slate-500">{row.destination}</span>}
      </td>
      <td className={`${tdClass} whitespace-nowrap text-slate-700`}>
        {row.startDate ? formatDate(row.startDate) : '—'}
        {row.endDate && row.endDate !== row.startDate && <span className="block">to {formatDate(row.endDate)}</span>}
      </td>
      <td className={tdClass}>
        <span className="flex flex-col items-start gap-1">
          <BookingStatusBadge status={row.status} type={row.type} paymentStatus={row.paymentStatus} />
          <Badge tone={payment.tone}>{payment.label}</Badge>
        </span>
      </td>
      <td className={`${tdClass} whitespace-nowrap text-right`}>
        <span className="font-medium text-slate-900">{formatMoney(row.totalAmount, row.currency, true)}</span>
        {row.refundedAmount > 0 && <span className="block text-xs text-slate-500">refunded {formatMoney(row.refundedAmount, row.currency, true)}</span>}
      </td>
      <td className={`${tdClass} whitespace-nowrap text-slate-700`}>{formatDateTime(row.createdAt)}</td>
    </tr>
  );
}
