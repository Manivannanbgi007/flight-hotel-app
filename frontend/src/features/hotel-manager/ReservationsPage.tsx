import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowRight, BedDouble, CalendarDays, ChevronDown, ClipboardList, SlidersHorizontal, UserRound, Users, X } from 'lucide-react';

import { ExportMenu } from '@/components/export/ExportMenu';
import { Alert } from '@/components/ui/Alert';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { TableCard } from '@/components/ui/DataTable';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { DateField } from '@/components/ui/DateField';
import { SelectField } from '@/components/ui/Field';
import { selectClass } from '@/components/ui/fieldStyles';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { EmptyState } from '@/components/ui/StateViews';
import { ListLoading } from '@/features/admin/shared/adminUi';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDate, formatDateTime, formatMoney, formatShortDate } from '@/lib/format';
import { isIsoDate } from './dateRange';
import { FilterPills, HotelPageError, ManagerPageHeader, ReservationStatusBadge, SearchBox, Toolbar, type PillOption } from './ManagerParts';
import { managerApi } from './managerApi';
import { operationsApi } from './operationsApi';
import type { ReservationFilters, ReservationRow, ReservationSort, ReservationStatus, ReservationSummary } from './operationsTypes';
import { guestLabel, RESERVATION_STATUSES, reservationStatusInfo } from './reservationStatus';
import { useManagerHotels } from './useManagerHotels';

const SORT_LABELS: Record<ReservationSort, string> = {
  'createdAt,desc': 'Newest bookings first',
  'checkIn,asc': 'Check-in: earliest first',
  'checkIn,desc': 'Check-in: latest first',
};
const SORTS = Object.keys(SORT_LABELS) as ReservationSort[];
const DEFAULT_SORT: ReservationSort = 'createdAt,desc';
/** Rows per page unless `?size=` asks for another of `PAGE_SIZES` (the API allows up to 100). */
const DEFAULT_PAGE_SIZE = 25;

/** The columns of an export (CSV, Excel, PDF): every figure of the table, one per column. */
const EXPORT_COLUMNS: ExportColumn<ReservationRow>[] = [
  { header: 'Guest', value: (row) => row.leadGuest },
  { header: 'Booking reference', value: (row) => row.bookingReference },
  { header: 'Confirmation number', value: (row) => row.confirmationNumber },
  { header: 'Status', value: (row) => reservationStatusInfo[row.status]?.label ?? row.status },
  { header: 'Check-in', value: (row) => row.checkIn, type: 'date' },
  { header: 'Check-out', value: (row) => row.checkOut, type: 'date' },
  { header: 'Nights', value: (row) => row.nights, type: 'integer' },
  { header: 'Room type', value: (row) => row.roomTypeName },
  { header: 'Rooms', value: (row) => row.rooms, type: 'integer' },
  { header: 'Rate plan', value: (row) => row.ratePlanName },
  { header: 'Adults', value: (row) => row.adults, type: 'integer' },
  { header: 'Children', value: (row) => row.children, type: 'integer' },
  { header: 'Amount', value: (row) => row.totalAmount, type: 'money' },
  { header: 'Booked at', value: (row) => row.createdAt, type: 'datetime' },
];

/** The quick status filters above the list, with the count of each (for the list's other filters). */
const STATUS_PILLS: { status: ReservationStatus | ''; label: string; key: keyof ReservationSummary; dot?: string }[] = [
  { status: '', label: 'All', key: 'total' },
  { status: 'CONFIRMED', label: 'Confirmed', key: 'confirmed', dot: 'bg-success-500' },
  { status: 'HELD', label: 'Pending payment', key: 'pending', dot: 'bg-warning-500' },
  { status: 'CHECKED_IN', label: 'Checked in', key: 'checkedIn', dot: 'bg-info-500' },
  { status: 'CHECKED_OUT', label: 'Checked out', key: 'checkedOut', dot: 'bg-slate-400' },
  { status: 'CANCELLED', label: 'Cancelled', key: 'cancelled', dot: 'bg-danger-500' },
];

function readReservationFilters(params: URLSearchParams): ReservationFilters {
  const status = params.get('status') as ReservationStatus | null;
  const sort = params.get('sort') as ReservationSort | null;
  const from = params.get('from');
  const to = params.get('to');
  return {
    status: status && RESERVATION_STATUSES.includes(status) ? status : '',
    dateField: params.get('dateField') === 'CREATED' ? 'CREATED' : 'CHECK_IN',
    from: isIsoDate(from) ? from : '',
    to: isIsoDate(to) ? to : '',
    q: params.get('q')?.trim() ?? '',
    sort: sort && SORTS.includes(sort) ? sort : DEFAULT_SORT,
    page: Math.max(0, Number(params.get('page') ?? 0) || 0),
    roomTypeId: params.get('roomType') ?? '',
  };
}

/**
 * /hotel-manager/hotels/:hotelId/reservations — every reservation of the hotel: status pills with counts, a search, more
 * filters on demand (status, room type, dates) and sorting, all kept in the URL. Live: `hotel.reservation-changed`
 * refreshes the list.
 */
export function ReservationsPage() {
  const { hotelId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const filters = readReservationFilters(params);
  const size = readPageSize(params, PAGE_SIZES, DEFAULT_PAGE_SIZE);
  const datesWrong = filters.from !== '' && filters.to !== '' && filters.from > filters.to;
  const results = useQuery({
    queryKey: queryKeys.hotelManager.reservationList(hotelId, { ...filters, size }),
    queryFn: () => operationsApi.reservations(hotelId, filters, size),
    placeholderData: keepPreviousData,
    enabled: !datesWrong,
  });
  // The counts on the pills follow every filter but the status (the pills are the status filter).
  const summaryFilters = { from: filters.from, to: filters.to, dateField: filters.dateField, q: filters.q, roomTypeId: filters.roomTypeId };
  const summary = useQuery({
    queryKey: queryKeys.hotelManager.reservationSummary(hotelId, summaryFilters),
    queryFn: () => operationsApi.reservationSummary(hotelId, { ...filters, ...summaryFilters }),
    placeholderData: keepPreviousData,
    enabled: !datesWrong,
  });
  const roomTypes = useQuery({
    queryKey: queryKeys.hotelManager.roomTypes(hotelId),
    queryFn: () => managerApi.roomTypes(hotelId),
    staleTime: 60_000,
  });

  /** Any change but paging starts again on page 1. */
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  // "More filters" opens by itself when one of them is set (a shared link, the browser's back button).
  const pillStatus = STATUS_PILLS.some((pill) => pill.status === filters.status);
  const moreActive = [filters.roomTypeId, filters.from, filters.to].filter(Boolean).length
    + (filters.dateField === 'CREATED' ? 1 : 0) + (pillStatus ? 0 : 1);
  const [showMore, setShowMore] = useState(moreActive > 0);
  const roomName = (roomTypes.data ?? []).find((type) => type.id === filters.roomTypeId)?.name;

  const hotelName = useManagerHotels().data?.find((hotel) => hotel.id === hotelId)?.name;
  const data = results.data;
  const filtered = filters.status !== '' || filters.from !== '' || filters.to !== '' || filters.q !== '' || filters.roomTypeId !== '';
  const pills: PillOption<ReservationStatus | ''>[] = STATUS_PILLS.map((pill) => ({
    value: pill.status,
    label: pill.label,
    dot: pill.dot,
    count: summary.data ? summary.data[pill.key] : null,
  }));
  // The filters in force, as chips with a remove button (the status is on the pills).
  const dated = filters.dateField === 'CREATED' ? 'Booked' : 'Check-in';
  const activeChips: { label: string; clear: string }[] = [];
  if (filters.q) activeChips.push({ label: `“${filters.q}”`, clear: 'q' });
  if (filters.roomTypeId) activeChips.push({ label: roomName ?? 'One room type', clear: 'roomType' });
  if (filters.from) activeChips.push({ label: `${dated} from ${formatShortDate(filters.from)}`, clear: 'from' });
  if (filters.to) activeChips.push({ label: `${dated} until ${formatShortDate(filters.to)}`, clear: 'to' });

  return (
    <div className="flex flex-col gap-5">
      <ManagerPageHeader
        icon={<ClipboardList className="size-5" />}
        title="Reservations"
        description="Every stay booked at this hotel. Open one to see the guests and to check them in or out."
        actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>}
      />

      <Toolbar>
        <FilterPills label="Reservations by status" options={pills} value={pillStatus ? filters.status : null}
          onChange={(status) => update({ status: status === filters.status ? null : status || null })} />
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <SearchBox key={filters.q} initial={filters.q} onSearch={(q) => update({ q })}
            placeholder="Guest name, booking reference or confirmation number"
            hint="Booking reference, confirmation number or guest name." />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" aria-expanded={showMore} aria-controls="reservation-filters" onClick={() => setShowMore((open) => !open)}
              aria-label={moreActive > 0 ? `Filters, ${moreActive} set` : 'Filters'}>
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Filters
              {moreActive > 0 && (
                <span aria-hidden="true" className="rounded-full bg-role-600 px-1.5 text-xs font-bold text-white">{moreActive}</span>
              )}
              <ChevronDown className={cn('size-4 text-slate-500 transition-transform', showMore && 'rotate-180')} aria-hidden="true" />
            </Button>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
              <span className="sr-only sm:not-sr-only">Sort by</span>
              <select value={filters.sort} className={selectClass(false, { inline: true, size: 'sm' })}
                onChange={(event) => update({ sort: event.target.value === DEFAULT_SORT ? null : event.target.value })}>
                {SORTS.map((sort) => <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>)}
              </select>
            </label>
          </div>
        </div>
        {showMore && (
          <div id="reservation-filters" className="flex flex-col gap-3 rounded-xl bg-slate-50/80 p-3 ring-1 ring-inset ring-slate-200/70 animate-fade-in sm:p-4">
            {/* Columns of at least ~200 px, so a date ("Wed, 30 Sep 2026") fits; From and To stay side by side. */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
                <option value="">All bookings</option>
                {RESERVATION_STATUSES.map((status) => <option key={status} value={status}>{reservationStatusInfo[status].label}</option>)}
              </SelectField>
              <SelectField label="Room type" value={filters.roomTypeId} onChange={(event) => update({ roomType: event.target.value || null })}>
                <option value="">All room types</option>
                {(roomTypes.data ?? []).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </SelectField>
              <SelectField label="Dates by" value={filters.dateField}
                onChange={(event) => update({ dateField: event.target.value === 'CREATED' ? 'CREATED' : null })}>
                <option value="CHECK_IN">Check-in date</option>
                <option value="CREATED">Booking date</option>
              </SelectField>
              <DateField label="From" value={filters.from} onChange={(from) => update({ from })} rangeEnd={filters.to} />
              <DateField label="To" value={filters.to} min={filters.from || undefined} onChange={(to) => update({ to })} rangeStart={filters.from} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Held, expired and released reservations are only listed when you choose that status.</p>
              {moreActive > 0 && (
                <Button size="sm" variant="ghost" onClick={() => update({ status: pillStatus ? filters.status || null : null, roomType: null, dateField: null, from: null, to: null })}>
                  Reset these filters
                </Button>
              )}
            </div>
          </div>
        )}
      </Toolbar>

      {datesWrong && <Alert tone="warning">The start date must be on or before the end date.</Alert>}
      {!datesWrong && results.isPending && <ListLoading label="Loading reservations…" />}
      {results.isError && <HotelPageError error={results.error} onRetry={() => void results.refetch()} />}
      {!datesWrong && data && data.content.length === 0 && (
        <EmptyState
          illustration={filtered ? 'search' : 'inbox'}
          title={filtered ? 'No reservations match' : 'No reservations yet'}
          description={filtered ? 'Try other filters or clear the search.' : 'Reservations appear here as soon as guests book.'}
        />
      )}
      {!datesWrong && data && data.content.length > 0 && (
        <section aria-label="Results" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              className="order-last ml-auto"
              title="Reservations"
              subtitle={hotelName}
              fileName={`reservations-${hotelName ?? hotelId}`}
              columns={EXPORT_COLUMNS}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={(page, pageSize) => operationsApi.reservations(hotelId, { ...filters, page }, pageSize)}
              rowKey={(row) => row.reservationId}
              filters={describeFilters([
                ['Status', filters.status && reservationStatusInfo[filters.status].label],
                ['Search', filters.q],
                ['Room type', filters.roomTypeId && (roomName ?? filters.roomTypeId)],
                [filters.dateField === 'CREATED' ? 'Booked from' : 'Check-in from', filters.from && formatDate(filters.from)],
                [filters.dateField === 'CREATED' ? 'Booked until' : 'Check-in until', filters.to && formatDate(filters.to)],
                ['Sort', SORT_LABELS[filters.sort]],
              ])}
              personalData
            />
            <p className="text-sm font-semibold text-slate-900" role="status">
              {data.totalElements} reservation{data.totalElements === 1 ? '' : 's'}
            </p>
            {activeChips.map((chip) => (
              <span key={chip.label} className="inline-flex items-center gap-1 rounded-full bg-role-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-role-800 ring-1 ring-inset ring-role-100">
                {chip.label}
                <button type="button" onClick={() => update({ [chip.clear]: null })} aria-label={`Remove filter ${chip.label}`}
                  className="flex size-5 items-center justify-center rounded-full hover:bg-role-100">
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <ReservationTable rows={data.content} base={`/hotel-manager/hotels/${hotelId}/reservations`} />
          <Pagination
            data={data}
            onPageChange={(page) => update({ page: String(page) })}
            onPageSizeChange={(next) => update({ size: next === DEFAULT_PAGE_SIZE ? null : String(next) })}
            noun={['reservation', 'reservations']}
          />
        </section>
      )}
    </div>
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function ReservationTable({ rows, base }: { rows: ReservationRow[]; base: string }) {
  return (
    // Wider than the card on a 1280 px screen (the stay and reference lines do not wrap): scrolls, no sticky header.
    <TableCard caption="Reservations" scroll>
      <thead>
        <tr>
          <th scope="col" className={tableStyles.th}>Guest</th>
          <th scope="col" className={tableStyles.th}>Stay</th>
          <th scope="col" className={tableStyles.th}>Room and guests</th>
          <th scope="col" className={tableStyles.th}>Status</th>
          <th scope="col" className={`${tableStyles.th} ${tableStyles.numeric}`}>Amount</th>
          <th scope="col" className={tableStyles.th}><span className="sr-only">Open</span></th>
        </tr>
      </thead>
      <tbody className={tableStyles.tbody}>
        {rows.map((row) => (
          <tr key={row.reservationId} className={cn(tableStyles.tr, 'group')}>
            <td className="py-3 pl-4 pr-3">
              <div className="flex items-center gap-3">
                {row.leadGuest
                  ? <Avatar name={row.leadGuest} size="md" />
                  : <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"><UserRound className="size-5" /></span>}
                <div className="min-w-0">
                  <Link to={`${base}/${row.reservationId}`} className="font-semibold text-slate-900 hover:text-role-700 hover:underline">{guestLabel(row)}</Link>
                  <span className="block whitespace-nowrap text-xs tracking-wide text-slate-500">
                    {[row.bookingReference, row.confirmationNumber && `Conf. ${row.confirmationNumber}`].filter(Boolean).join(' · ')}
                  </span>
                </div>
              </div>
            </td>
            <td className="whitespace-nowrap px-3 py-3">
              <span className="flex items-center gap-1.5 font-medium text-slate-800">
                <CalendarDays className="size-4 text-slate-400" aria-hidden="true" />
                {formatShortDate(row.checkIn)} – {formatShortDate(row.checkOut)}
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                <span className="mr-1.5 rounded-md bg-slate-100 px-1.5 py-px font-semibold text-slate-700">{plural(row.nights, 'night', 'nights')}</span>
                booked {formatDateTime(row.createdAt)}
              </span>
            </td>
            <td className="min-w-56 px-3 py-3 text-slate-700">
              <span className="flex items-center gap-1.5 whitespace-nowrap font-medium text-slate-800">
                <BedDouble className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                {row.rooms} × {row.roomTypeName ?? 'Room'}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>{row.adults} adult{row.adults === 1 ? '' : 's'}{row.children > 0 ? `, ${row.children} child${row.children === 1 ? '' : 'ren'}` : ''}</span>
                </span>
                {row.ratePlanName && <><span aria-hidden="true">·</span><span>{row.ratePlanName}</span></>}
              </span>
            </td>
            <td className="whitespace-nowrap px-3 py-3"><ReservationStatusBadge status={row.status} /></td>
            <td className="whitespace-nowrap px-3 py-3 text-right text-base font-semibold tabular-nums text-slate-900">
              {row.totalAmount !== null ? formatMoney(row.totalAmount, 'INR', true) : '—'}
            </td>
            <td className="w-10 py-3 pl-1 pr-3 text-right">
              <Link to={`${base}/${row.reservationId}`} tabIndex={-1} aria-hidden="true"
                className="inline-flex size-8 items-center justify-center rounded-full text-slate-400 transition-colors group-hover:bg-role-50 group-hover:text-role-700">
                <ArrowRight className="size-4" />
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}
