import { useState, type FormEvent, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { BedDouble, CalendarClock, CircleCheckBig, CircleX, Hourglass, Plane, Search, X } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { ExportMenu } from '@/components/export/ExportMenu';
import { PageContainer } from '@/components/layout/PageContainer';
import { StormIllustration, SuitcaseIllustration } from '@/components/illustrations';
import { Button, ButtonLink } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES_UP_TO_50, readPageSize } from '@/components/ui/paginationItems';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { Tabs } from '@/components/ui/Tabs';
import { summaryApi, summaryQuery } from '@/features/customer/summaryApi';
import { DEFAULT_PRESET } from '@/features/customer/summaryRange';
import { mayBeReviewable, useEligibleStays } from '@/features/reviews/useReviews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { bookingApi } from './bookingApi';
import { Art } from './BookingUi';
import { bookingPaymentStatusInfo, bookingTabs, parseTab, statusLabel } from './status';
import { TripCard } from './TripCard';
import type { BookingSummary, BookingTab, TripFilters } from './types';

const emptyText: Record<BookingTab, { title: string; description: string }> = {
  ALL: { title: 'No trips yet', description: 'Your flights and stays show up here as soon as you book one. Where to next?' },
  PENDING: { title: 'Nothing here', description: 'No bookings are waiting for payment or confirmation.' },
  UPCOMING: { title: 'Nothing here', description: 'No upcoming trips. Time to plan the next one?' },
  COMPLETED: { title: 'Nothing here', description: 'Trips you have taken appear here after they end.' },
  CANCELLED: { title: 'Nothing here', description: 'No cancelled bookings.' },
};

/** Trips per page unless `?size=` asks for another; the API allows at most 50. */
const DEFAULT_PAGE_SIZE = 10;

const TYPE_OPTIONS: { value: '' | 'FLIGHT' | 'HOTEL'; label: string }[] = [
  { value: '', label: 'All trips' },
  { value: 'FLIGHT', label: 'Flights' },
  { value: 'HOTEL', label: 'Hotels' },
];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** A flight's route and cabin ("BOM → DEL, DEL → BOM · Economy"); a stay's rooms ("1 × Deluxe Sea View"). */
function routeOrRoom(trip: BookingSummary): string | null {
  if (trip.type === 'FLIGHT') {
    const slices = trip.flight?.slices ?? [];
    if (slices.length === 0) return null;
    const cabin = trip.flight?.cabin ? ` · ${trip.flight.cabin.charAt(0)}${trip.flight.cabin.slice(1).toLowerCase().replace('_', ' ')}` : '';
    return `${slices.map((slice) => `${slice.origin} → ${slice.destination}`).join(', ')}${cabin}`;
  }
  const stay = trip.stay;
  if (!stay?.roomTypeName) return null;
  return stay.rooms ? `${stay.rooms} × ${stay.roomTypeName}` : stay.roomTypeName;
}

/** The travellers' names of a flight; the guests of a stay ("2 adults, 1 child"). */
function travellers(trip: BookingSummary): string | null {
  if (trip.type === 'FLIGHT' && trip.flight) {
    const { passengerNames, adults, children, infants } = trip.flight;
    return passengerNames.length > 0 ? passengerNames.join(', ') : plural(adults + children + infants, 'traveller', 'travellers');
  }
  const stay = trip.stay;
  if (!stay?.adults) return null;
  return [plural(stay.adults, 'adult', 'adults'), stay.children ? plural(stay.children, 'child', 'children') : null].filter(Boolean).join(', ');
}

/** The columns of an export of My Trips: what each card shows. Each amount is in its trip's own currency. */
const TRIP_COLUMNS: ExportColumn<BookingSummary>[] = [
  { header: 'Reference', value: (trip) => trip.reference },
  { header: 'Type', value: (trip) => (trip.type === 'FLIGHT' ? 'Flight' : 'Hotel') },
  { header: 'Trip', value: (trip) => trip.title ?? (trip.type === 'FLIGHT' ? 'Flight booking' : 'Hotel booking') },
  { header: 'Destination', value: (trip) => trip.stay?.city ?? trip.destination },
  { header: 'Route or room', value: routeOrRoom },
  { header: 'From', value: (trip) => trip.startDate, type: 'date' },
  { header: 'To', value: (trip) => trip.endDate, type: 'date' },
  { header: 'Nights', value: (trip) => trip.stay?.nights ?? null, type: 'integer' },
  { header: 'Travellers', value: travellers },
  { header: 'Status', value: (trip) => statusLabel(trip.status, trip.type, trip.paymentStatus) },
  { header: 'Payment', value: (trip) => bookingPaymentStatusInfo[trip.paymentStatus]?.label ?? trip.paymentStatus },
  { header: 'Amount', value: (trip) => trip.totalAmount, type: 'money', currency: (trip) => trip.currency },
  { header: 'Currency', value: (trip) => trip.currency },
  { header: 'Booked at', value: (trip) => trip.createdAt, type: 'datetime' },
];

/**
 * /my-trips — the customer's bookings: an overview of how many trips are upcoming, completed, cancelled or waiting
 * (the booking service's own figures), search and a flights / hotels filter, and the trips in tabs. The tab, search,
 * type, page and page size are in the URL, so the back button and shared links work.
 */
export function MyTripsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const q = params.get('q')?.trim() ?? '';
  const typeParam = params.get('type');
  const type: TripFilters['type'] = typeParam === 'FLIGHT' || typeParam === 'HOTEL' ? typeParam : '';
  const filters: TripFilters = { q, type };
  const filtered = Boolean(q || type);
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const size = readPageSize(params, PAGE_SIZES_UP_TO_50, DEFAULT_PAGE_SIZE);
  const trips = useQuery({
    queryKey: queryKeys.bookings.list({ tab, page, size, ...(filtered ? { q, type } : {}) }),
    queryFn: () => (filtered ? bookingApi.list(tab, page, size, filters) : bookingApi.list(tab, page, size)),
    placeholderData: keepPreviousData,
  });
  // The overview: the same cached summary the dashboard shows (`trips` does not depend on the period).
  const overview = useQuery({
    queryKey: queryKeys.bookings.summary(summaryQuery({ range: DEFAULT_PRESET })),
    queryFn: () => summaryApi.summary({ range: DEFAULT_PRESET }),
    staleTime: 30_000,
  });
  // "Write a review" for stays the server lists as reviewable; asked only when a trip on this page could be one.
  const eligible = useEligibleStays(trips.data?.content.some((trip) => mayBeReviewable(trip)) ?? false);
  const reviewable = new Set(eligible.data?.map((stay) => stay.bookingId));
  const counts = overview.data?.trips;

  /** Another tab, filter or page size starts again on page 1. */
  const go = (next: { tab?: string; page?: number; size?: number; q?: string; type?: string }) => {
    const updated = new URLSearchParams(params);
    if (next.tab !== undefined) updated.set('tab', next.tab);
    if (next.q !== undefined) {
      if (next.q) updated.set('q', next.q);
      else updated.delete('q');
    }
    if (next.type !== undefined) {
      if (next.type) updated.set('type', next.type);
      else updated.delete('type');
    }
    if (next.size !== undefined) {
      if (next.size === DEFAULT_PAGE_SIZE) updated.delete('size');
      else updated.set('size', String(next.size));
    }
    if (next.page !== undefined) updated.set('page', String(next.page));
    if (next.tab !== undefined || next.size !== undefined || next.q !== undefined || next.type !== undefined) updated.delete('page');
    setParams(updated);
  };

  const noTripsAtAll = tab === 'ALL' && !filtered && trips.data?.content.length === 0;
  const shown = trips.data && trips.data.content.length > 0 ? trips.data : null;
  // My own trips only: the same call as the list (the server scopes it to the signed-in customer), same tab and filters.
  const exportMenu = shown && (
    <ExportMenu
      title="My trips"
      subtitle={user ? `${user.firstName} ${user.lastName}` : undefined}
      fileName="my-trips"
      columns={TRIP_COLUMNS}
      rows={shown.content}
      total={shown.totalElements}
      pageLabel={`Page ${shown.page + 1} of ${Math.max(shown.totalPages, 1)}`}
      fetchPage={(pageNo, pageSize) => (filtered ? bookingApi.list(tab, pageNo, pageSize, filters) : bookingApi.list(tab, pageNo, pageSize))}
      rowKey={(trip) => trip.id}
      filters={describeFilters([
        ['Trips', tab === 'ALL' ? null : bookingTabs.find((item) => item.value === tab)?.label],
        ['Search', q],
        ['Kind of trip', type ? TYPE_OPTIONS.find((option) => option.value === type)?.label : null],
      ])}
      personalData
    />
  );
  const body = (
    <>
      {trips.isPending && <TripsLoading />}
      {trips.isError && (
        <ErrorState illustration={<Art><StormIllustration /></Art>} description={ApiError.from(trips.error).message}
          onRetry={() => void trips.refetch()} />
      )}
      {trips.data && trips.data.content.length === 0 && (
        <EmptyState
          title={filtered ? 'No trips match your search' : emptyText[tab].title}
          description={filtered ? 'Try other words, or show all kinds of trips.' : emptyText[tab].description}
          illustration={<Art size={tab === 'ALL' && !filtered ? 'lg' : 'sm'}><SuitcaseIllustration /></Art>}
          compact={tab !== 'ALL' || filtered}
          action={filtered ? (
            <Button variant="secondary" size="sm" onClick={() => go({ q: '', type: '' })}>Clear the search</Button>
          ) : (
            <>
              <ButtonLink to="/flights" size={tab === 'ALL' ? 'md' : 'sm'}><Plane className="size-4" aria-hidden="true" />Search flights</ButtonLink>
              <ButtonLink to="/hotels" variant="secondary" size={tab === 'ALL' ? 'md' : 'sm'}><BedDouble className="size-4" aria-hidden="true" />Search hotels</ButtonLink>
            </>
          )}
        />
      )}
      {trips.data && trips.data.content.length > 0 && (
        <>
          <ul className="stagger flex flex-col gap-4" aria-label="Bookings">
            {trips.data.content.map((trip) => <TripCard key={trip.id} trip={trip} canReview={reviewable.has(trip.id)} />)}
          </ul>
          <Pagination
            data={trips.data}
            onPageChange={(next) => go({ page: next })}
            onPageSizeChange={(next) => go({ size: next })}
            pageSizes={PAGE_SIZES_UP_TO_50}
            noun={['trip', 'trips']}
            sizeLabel="Per page"
            className="mt-6"
          />
        </>
      )}
    </>
  );

  const tabCount = (value: BookingTab): ReactNode => {
    if (!counts) return undefined;
    const figure = value === 'UPCOMING' ? counts.upcoming : value === 'COMPLETED' ? counts.completed
      : value === 'CANCELLED' ? counts.cancelled : value === 'PENDING' ? counts.pending : null;
    return figure === null ? undefined : <span className="rounded-full bg-slate-200/70 px-1.5 text-xs tabular-nums text-slate-700">{figure}</span>;
  };

  return (
    <PageContainer width="lg">
      <PageHeader
        eyebrow="Your bookings"
        title="My Trips"
        description="Every flight and stay you booked: follow their status, pay, download documents or cancel."
        actions={noTripsAtAll ? undefined : (
          <>
            {exportMenu}
            <ButtonLink to="/flights" variant="secondary" size="sm"><Plane className="size-4" aria-hidden="true" />Book a flight</ButtonLink>
            <ButtonLink to="/hotels" variant="secondary" size="sm"><BedDouble className="size-4" aria-hidden="true" />Book a hotel</ButtonLink>
          </>
        )}
      />

      {!noTripsAtAll && (counts || overview.isPending) && (
        <ul aria-label="Trip overview" className="stagger mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <li><StatCard className="h-full" label="Upcoming" value={counts?.upcoming ?? 0} loading={overview.isPending} to="/my-trips?tab=UPCOMING" icon={<CalendarClock className="size-5" />} /></li>
          <li><StatCard className="h-full" label="Completed" value={counts?.completed ?? 0} loading={overview.isPending} to="/my-trips?tab=COMPLETED" icon={<CircleCheckBig className="size-5" />} /></li>
          <li><StatCard className="h-full" label="Cancelled" value={counts?.cancelled ?? 0} loading={overview.isPending} to="/my-trips?tab=CANCELLED" icon={<CircleX className="size-5" />} /></li>
          <li><StatCard className="h-full" label="Pending" value={counts?.pending ?? 0} loading={overview.isPending} to="/my-trips?tab=PENDING" icon={<Hourglass className="size-5" />} /></li>
        </ul>
      )}

      {!noTripsAtAll && <TripSearch key={`${q}|${type}`} q={q} type={type} onChange={(next) => go(next)} />}

      <Tabs
        className="mt-5"
        variant="pills"
        label="Trip status"
        value={tab}
        onChange={(value) => go({ tab: value })}
        items={bookingTabs.map((item) => ({ id: item.value, label: item.label, badge: tabCount(item.value), content: body }))}
      />
    </PageContainer>
  );
}

/** Search words (reference, hotel, city or route) and the flights / hotels switch. */
function TripSearch({ q, type, onChange }: {
  q: string;
  type: TripFilters['type'];
  onChange: (next: { q?: string; type?: string }) => void;
}) {
  const [text, setText] = useState(q);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onChange({ q: text.trim() });
  };
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <form role="search" aria-label="Search my trips" onSubmit={submit} className="relative min-w-0 flex-1">
        <label htmlFor="trip-search" className="sr-only">Search my trips</label>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          id="trip-search"
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search by reference, hotel, city or route"
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-20 text-sm text-slate-900 shadow-xs placeholder:text-slate-500 transition-[border-color,box-shadow] duration-(--duration-fast) hover:border-slate-300 focus:border-role-400 focus:ring-4 focus:ring-role-500/15 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {q && (
          <button type="button" aria-label="Clear search" onClick={() => { setText(''); onChange({ q: '' }); }}
            className="absolute right-[4.5rem] top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
        <Button type="submit" size="sm" className="absolute right-1.5 top-1/2 -translate-y-1/2">Search</Button>
      </form>
      <div role="group" aria-label="Kind of trip" className="inline-flex shrink-0 gap-1 rounded-full bg-slate-100 p-1">
        {TYPE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={type === option.value}
            onClick={() => onChange({ type: option.value })}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors duration-(--duration-fast)',
              type === option.value ? 'bg-white text-role-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TripsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <span role="status" className="sr-only">Loading your trips…</span>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
          <Skeleton className="hidden h-24 w-40 shrink-0 rounded-2xl sm:block" />
          <div className="flex flex-1 flex-col gap-2.5">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-8 w-2/3 rounded-lg" />
          </div>
          <Skeleton className="hidden h-6 w-24 sm:block" />
        </div>
      ))}
    </div>
  );
}
