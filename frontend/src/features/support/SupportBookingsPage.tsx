import { useId, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AlertTriangle, ArrowRight, BedDouble, ChevronRight, Plane, Search as SearchIcon } from 'lucide-react';

import { ExportMenu } from '@/components/export/ExportMenu';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CheckboxField, SelectField, TextField } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES_UP_TO_50, readPageSize } from '@/components/ui/paginationItems';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { BookingStatusBadge } from '@/features/bookings/BookingParts';
import { bookingPaymentStatusInfo, statusInfo, statusLabel } from '@/features/bookings/status';
import type { BookingStatus } from '@/features/bookings/types';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Initials } from '@/features/admin/dashboard/dashKit';
import { PillTabs, ResultCount, SupportHero } from './SupportKit';
import { FilterCard, ListLoading } from '@/features/admin/shared/adminUi';
import { TableCard } from '@/components/ui/DataTable';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { attentionLabel } from './attention';
import { supportApi } from './supportApi';
import type { SupportBookingFilters, SupportBookingRow } from './types';

const STATUSES = Object.keys(statusInfo) as BookingStatus[];

/** The columns of an export (CSV, Excel, PDF): what the table shows, one figure per column. Support notes stay out. */
const EXPORT_COLUMNS: ExportColumn<SupportBookingRow>[] = [
  { header: 'Reference', value: (row) => row.reference },
  { header: 'Type', value: (row) => (row.type === 'FLIGHT' ? 'Flight' : 'Hotel') },
  { header: 'Demo booking', value: (row) => row.demo },
  { header: 'Lead traveller', value: (row) => row.leadName },
  { header: 'Contact e-mail', value: (row) => row.contactEmail },
  { header: 'Trip', value: (row) => row.title, width: 32 },
  { header: 'Destination', value: (row) => row.destination },
  { header: 'From', value: (row) => row.startDate, type: 'date' },
  { header: 'To', value: (row) => row.endDate, type: 'date' },
  { header: 'Status', value: (row) => statusLabel(row.status, row.type, row.paymentStatus) },
  { header: 'Payment', value: (row) => bookingPaymentStatusInfo[row.paymentStatus]?.label ?? row.paymentStatus },
  // Each booking in its own currency; the code in a column of its own keeps the CSV's plain numbers clear.
  { header: 'Amount', value: (row) => row.totalAmount, type: 'money', currency: (row) => row.currency },
  { header: 'Currency', value: (row) => row.currency },
  { header: 'Needs attention', value: (row) => (row.attentionReason ? attentionLabel(row.attentionReason) : null) },
  { header: 'Flagged since', value: (row) => row.attentionSince, type: 'datetime' },
  { header: 'Booked at', value: (row) => row.createdAt, type: 'datetime' },
];
/** Rows per page unless `?size=` asks for another; the support search allows at most 50. */
const DEFAULT_PAGE_SIZE = 25;

/** /support — find any booking by reference, e-mail, PNR or hotel confirmation number. */
export function SupportBookingsPage() {
  return <BookingLookup queue={false} />;
}

/** /support/attention — the "Needs attention" queue: flagged bookings, oldest flag first. */
export function NeedsAttentionPage() {
  return <BookingLookup queue />;
}

function readFilters(params: URLSearchParams, queue: boolean): SupportBookingFilters {
  const status = params.get('status');
  const type = params.get('type');
  return {
    q: params.get('q')?.trim() ?? '',
    status: STATUSES.includes(status as BookingStatus) ? (status as BookingStatus) : '',
    type: type === 'HOTEL' || type === 'FLIGHT' ? type : '',
    attention: queue || params.get('attention') === 'true',
    page: Math.max(0, Number(params.get('page') ?? 0) || 0),
  };
}

function BookingLookup({ queue }: { queue: boolean }) {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params, queue);
  const size = readPageSize(params, PAGE_SIZES_UP_TO_50, DEFAULT_PAGE_SIZE);
  const results = useQuery({
    queryKey: queryKeys.support.bookingSearch({ ...filters, size }),
    queryFn: () => supportApi.searchBookings(filters, size),
    placeholderData: keepPreviousData,
  });

  /** Filters live in the URL (shareable, the back button works); any change but paging starts at page 1. */
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  const data = results.data;
  return (
    <div className="flex flex-col gap-4">
      <SupportHero
        icon={queue ? AlertTriangle : SearchIcon}
        title={queue ? 'Needs attention' : 'Booking lookup'}
        description={queue
          ? 'Bookings flagged by the system or escalated by an agent, oldest first. Mark a booking resolved once it is handled.'
          : 'Find a booking to help a customer. Open it to see everything and to act on it.'}
        chips={[{ label: queue ? 'Flagged bookings' : 'Bookings found', value: data?.totalElements, icon: queue ? AlertTriangle : SearchIcon, urgent: queue }]}
      />

      <PillTabs
        label="Quick type filter"
        active={filters.type || 'ALL'}
        onSelect={(key) => update({ type: key === 'ALL' ? null : key })}
        tabs={[
          { key: 'ALL', label: 'Hotels and flights' },
          { key: 'HOTEL', label: 'Hotels', icon: BedDouble },
          { key: 'FLIGHT', label: 'Flights', icon: Plane },
        ]}
      />

      <FilterCard>
        <SearchForm key={filters.q} initial={filters.q} onSearch={(q) => update({ q })} />
        <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </SelectField>
          <SelectField label="Type" value={filters.type} onChange={(event) => update({ type: event.target.value })}>
            <option value="">Hotels and flights</option>
            <option value="HOTEL">Hotels</option>
            <option value="FLIGHT">Flights</option>
          </SelectField>
          {!queue && (
            <div className="pb-2">
              <CheckboxField label="Needs attention only" checked={filters.attention}
                onChange={(event) => update({ attention: event.target.checked ? 'true' : null })} />
            </div>
          )}
        </div>
      </FilterCard>

      {results.isPending && <ListLoading label="Loading bookings…" />}
      {results.isError && <LoadError error={ApiError.from(results.error)} onRetry={() => void results.refetch()} />}
      {data && data.content.length === 0 && (
        <EmptyState
          illustration={queue ? 'inbox' : 'search'}
          title={queue ? 'Nothing needs attention' : 'No bookings found'}
          description={filters.q ? 'The search looks for an exact reference, e-mail, PNR or confirmation number.' : undefined}
        />
      )}
      {data && data.content.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ResultCount total={data.totalElements} noun={['booking', 'bookings']} />
            <ExportMenu
              className="ml-auto"
              title={queue ? 'Bookings needing attention' : 'Bookings'}
              fileName={queue ? 'bookings-needing-attention' : 'support-bookings'}
              columns={EXPORT_COLUMNS}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={(page, pageSize) => supportApi.searchBookings({ ...filters, page }, pageSize)}
              rowKey={(row) => row.id}
              filters={describeFilters([
                ['Search', filters.q],
                ['Status', filters.status && statusLabel(filters.status)],
                ['Type', filters.type && (filters.type === 'FLIGHT' ? 'Flights' : 'Hotels')],
                ['Needs attention only', !queue && filters.attention && 'Yes'],
              ])}
              personalData
            />
          </div>
          <ResultsTable rows={data.content} queue={queue} />
          <Pagination
            data={data}
            jump
            onPageChange={(page) => update({ page: String(page) })}
            onPageSizeChange={(next) => update({ size: next === DEFAULT_PAGE_SIZE ? null : String(next) })}
            pageSizes={PAGE_SIZES_UP_TO_50}
            noun={['booking', 'bookings']}
          />
        </>
      )}
    </div>
  );
}

function LoadError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return <ErrorState description={error.message} correlationId={error.correlationId} onRetry={onRetry} />;
}

function SearchForm({ initial, onSearch }: { initial: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(initial);
  const hintId = useId();
  return (
    <form role="search" className="flex flex-col gap-1" onSubmit={(event) => { event.preventDefault(); onSearch(text.trim()); }}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <TextField label="Search" type="search" value={text} onChange={(event) => setText(event.target.value)}
            placeholder="HT-7K3M9Q2X or asha@example.com" aria-describedby={hintId} />
        </div>
        <Button type="submit" variant="role"><SearchIcon className="size-4" aria-hidden="true" />Search</Button>
        {initial && <Button variant="ghost" onClick={() => { setText(''); onSearch(''); }}>Clear</Button>}
      </div>
      <p id={hintId} className="text-xs text-slate-500">Booking reference, e-mail, PNR or hotel confirmation number (exact match).</p>
    </form>
  );
}

function ResultsTable({ rows, queue }: { rows: SupportBookingRow[]; queue: boolean }) {
  const navigate = useNavigate();
  return (
    // In the queue every row has a "since …" line that does not wrap: too wide for the card on a 1280 px screen, so it
    // scrolls (no sticky header). The search results keep the sticky header (the card scrolls if they turn out too wide).
    <TableCard caption={queue ? 'Bookings that need attention' : 'Bookings'} scroll={queue}>
      <thead>
        <tr>
          <th scope="col" className={tableStyles.th}>Reference</th>
          <th scope="col" className={tableStyles.th}>Customer</th>
          <th scope="col" className={tableStyles.th}>Trip</th>
          <th scope="col" className={tableStyles.th}>Dates</th>
          <th scope="col" className={tableStyles.th}>Status</th>
          <th scope="col" className={tableStyles.th}>Payment</th>
          <th scope="col" className={`${tableStyles.th} ${tableStyles.numeric}`}>Amount</th>
          <th scope="col" className={tableStyles.th}>Attention</th>
        </tr>
      </thead>
      <tbody className={tableStyles.tbody}>
        {rows.map((row) => {
          const to = `/support/bookings/${row.id}`;
          const payment = bookingPaymentStatusInfo[row.paymentStatus];
          return (
            <tr
              key={row.id}
              className={`${tableStyles.tr} group cursor-pointer align-top`}
              // The reference is the keyboard and screen reader way in; the whole row is a bigger target for the mouse.
              onClick={(event) => { if (!(event.target as HTMLElement).closest('a, button')) void navigate(to); }}
            >
              <td className={cn('relative whitespace-nowrap px-4 py-3 before:absolute before:inset-y-2.5 before:left-0 before:w-1 before:rounded-r-full',
                row.attentionReason ? 'before:bg-danger-500' : row.type === 'FLIGHT' ? 'before:bg-info-400' : 'before:bg-role-400')}>
                <span className="flex items-center gap-2.5">
                  <span aria-hidden="true" className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
                    row.type === 'FLIGHT' ? 'bg-info-50 text-info-600 ring-info-100' : 'bg-role-50 text-role-600 ring-role-100')}>
                    {row.type === 'FLIGHT' ? <Plane className="size-4" /> : <BedDouble className="size-4" />}
                  </span>
                  <span>
                    <Link to={to} className="font-semibold text-role-700 hover:underline">{row.reference}</Link>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {row.type === 'FLIGHT' ? 'Flight' : 'Hotel'}{row.demo ? ' · demo' : ''}
                    </span>
                  </span>
                </span>
              </td>
              <td className="min-w-56 px-4 py-3">
                <span className="flex items-center gap-2.5">
                  <Initials name={row.leadName} email={row.contactEmail} className="size-8 text-xs" />
                  <span className="min-w-0">
                    {row.leadName && <span className="block font-medium text-slate-900">{row.leadName}</span>}
                    <span className="block break-words text-slate-600 [overflow-wrap:anywhere]">{row.contactEmail}</span>
                  </span>
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="block text-slate-900">{row.title ?? '—'}</span>
                {row.destination && <span className="block text-xs text-slate-500">{row.destination}</span>}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                {row.startDate ? formatDate(row.startDate) : '—'}
                {row.endDate && row.endDate !== row.startDate && (
                  <span className="flex items-center gap-1 text-xs text-slate-500"><ArrowRight className="size-3" aria-hidden="true" />to {formatDate(row.endDate)}</span>
                )}
              </td>
              <td className="px-4 py-3"><BookingStatusBadge status={row.status} type={row.type} paymentStatus={row.paymentStatus} /></td>
              <td className="px-4 py-3"><Badge tone={payment.tone}>{payment.label}</Badge></td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-base font-bold text-slate-900 tabular-nums">{formatMoney(row.totalAmount, row.currency, true)}</td>
              <td className="px-4 py-3">
                <span className="flex items-center justify-between gap-2">
                  <span>
                    {row.attentionReason ? (
                      <>
                        <Badge tone="danger" dot>{attentionLabel(row.attentionReason)}</Badge>
                        {row.attentionSince && <span className="mt-0.5 block whitespace-nowrap text-xs text-slate-500">since {formatDateTime(row.attentionSince)}</span>}
                      </>
                    ) : <span className="text-slate-400">—</span>}
                  </span>
                  <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-slate-300 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-role-600 motion-reduce:transform-none" />
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableCard>
  );
}
