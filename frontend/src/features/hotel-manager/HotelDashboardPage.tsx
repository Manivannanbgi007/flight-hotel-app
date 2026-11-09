import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import {
  ArrowRight, Ban, BedDouble, CalendarCheck2, Clock3, IndianRupee, LayoutDashboard, MessageSquareText, Percent, Star, TrendingUp, Users,
  Wallet,
} from 'lucide-react';

import {
  AnalyticsFilters, categoryFormat, categoryLabel, HighlightFigure, HighlightPanel, INTERVAL_LABELS, toStatChange, useAnalyticsQuery,
} from '@/components/analytics';
import { BarChart, ChartCard, DonutChart, formatCount, formatINR, formatPercent, LineChart, seriesColor } from '@/components/charts';
import { Reveal } from '@/components/motion/Reveal';
import { Avatar } from '@/components/ui/Avatar';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Section } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDate, formatShortDate } from '@/lib/format';
import { HotelPageError, ManagerPageHeader, MetricGrid, MetricTile, ReservationStatusBadge, SectionCard } from './ManagerParts';
import { operationsApi } from './operationsApi';
import type { HotelDashboard, ReservationRow } from './operationsTypes';
import { guestLabel } from './reservationStatus';
import { useHotelDashboard } from './useHotelDashboard';

const money = (value: number) => formatINR(value);
const plural = (value: number, one: string, many: string) => `${formatCount(value)} ${value === 1 ? one : many}`;
const rating = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const linkClass = 'inline-flex items-center gap-1 text-sm font-semibold text-role-700 hover:underline';
/** A link on the dark "today" band (white on role-900 passes AA). */
const bandLinkClass =
  'inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold text-white ring-1 ring-inset ring-white/25 transition-colors hover:bg-white/20';

/**
 * /hotel-manager/hotels/:hotelId/dashboard — the hotel's dashboard v2 (api-analytics §4): today at the front desk, the
 * arrivals of the next 7 days next to tonight's rooms, then occupancy, ADR, RevPAR, revenue, reservations,
 * cancellations and ratings for a range (in the URL) against the previous period, with their trends. Live:
 * `hotel.reservation-changed`, `dashboard.updated`.
 */
export function HotelDashboardPage() {
  const { hotelId = '' } = useParams();
  const [query, setQuery] = useAnalyticsQuery();
  const dashboard = useHotelDashboard(hotelId, query);
  const data = dashboard.data;
  const base = `/hotel-manager/hotels/${hotelId}`;
  const problem = dashboard.isError ? ApiError.from(dashboard.error) : null;

  if (problem?.code === 'HOTEL_NOT_ASSIGNED') {
    return <HotelPageError error={dashboard.error} />;
  }
  const loading = dashboard.isPending;
  const updating = dashboard.isFetching && dashboard.isPlaceholderData;
  const today = data?.today.date;

  return (
    <div className="flex flex-col gap-6">
      <ManagerPageHeader
        icon={<LayoutDashboard className="size-5" />}
        title="Dashboard"
        description="Today at the front desk first, then how the hotel performs over the period you choose."
        actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>}
      />

      {(loading || data) && (
        <HighlightPanel
          as="h3"
          title="Today at the front desk"
          description={today ? formatDate(today) : 'The hotel’s own day'}
          actions={today && (
            <Link to={`${base}/reservations?from=${today}&to=${today}&sort=checkIn%2Casc`} className={bandLinkClass}>
              Today’s arrivals<ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          )}
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4 lg:divide-x lg:divide-white/15 lg:[&>*:not(:first-child)]:pl-6">
            <HighlightFigure label="Arriving" value={data?.today.arrivals ?? 0} format={formatCount} loading={loading}
              note={data && plural(data.today.arrivingGuests, 'guest', 'guests')} />
            <HighlightFigure label="Departing" value={data?.today.departures ?? 0} format={formatCount} loading={loading}
              note={data && plural(data.today.departingGuests, 'guest', 'guests')} />
            <HighlightFigure label="In-house guests" value={data?.today.inHouseGuests ?? 0} format={formatCount} loading={loading}
              note={data && `${plural(data.today.inHouseRooms, 'room', 'rooms')} · ${plural(data.today.inHouse, 'reservation', 'reservations')}`} />
            <HighlightFigure label="Occupancy tonight" value={data?.today.occupancyPercent ?? 0} format={formatPercent} loading={loading}
              note={data?.today.roomsBooked !== undefined && data.today.roomsForSale !== undefined
                ? `${formatCount(data.today.roomsBooked)} of ${formatCount(data.today.roomsForSale)} rooms for sale booked`
                : 'Rooms sold tonight'} />
          </div>
        </HighlightPanel>
      )}

      {data && (
        <>
          <SectionCard
            id="arrivals"
            icon={<CalendarCheck2 className="size-5" />}
            title="Arrivals in the next 7 days"
            description={data.upcomingArrivals.length > 0
              ? `${plural(data.upcomingArrivals.length, 'reservation', 'reservations')} checking in soon`
              : 'Nobody is due in the coming week'}
            actions={<Link to={`${base}/reservations`} className={linkClass}>Open the reservation list<ArrowRight className="size-4" aria-hidden="true" /></Link>}
            bodyClassName="px-2 pb-2 pt-3"
          >
            <UpcomingArrivals rows={data.upcomingArrivals} base={base} />
          </SectionCard>
          <RoomsAndStatus today={data.today} hotelId={hotelId} />
        </>
      )}

      <div className="mt-2 flex items-center gap-3">
        <h3 className="text-lg font-bold tracking-tight text-slate-900">Performance</h3>
        <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-slate-300 to-transparent" />
      </div>

      <AnalyticsFilters
        key={JSON.stringify(query)}
        value={query}
        onChange={setQuery}
        served={data ? { range: data.range, interval: data.interval, previousRange: data.previousRange } : null}
        busy={updating}
      />

      {problem && (
        <HotelPageError
          error={dashboard.error}
          onRetry={() => void dashboard.refetch()}
          onAutoInterval={problem.code === 'INVALID_INTERVAL' ? () => setQuery({ ...query, interval: null }) : undefined}
        />
      )}
      {(loading || data) && <Figures data={data} base={base} />}
      {(loading || data) && <Trends data={data} loading={loading} />}
    </div>
  );
}

function Figures({ data, base }: { data?: HotelDashboard; base: string }) {
  const loading = !data;
  const c = data?.comparison;
  return (
    <div className="flex flex-col gap-8" aria-busy={loading || undefined}>
      <Section as="h3" id="performance" title="Rooms and revenue" description="Room nights of the range; revenue is room charges without GST">
        <MetricGrid label="Rooms and revenue">
          <MetricTile label="Occupancy" value={data?.stats.occupancyPercent ?? 0} format={formatPercent} loading={loading}
            icon={<BedDouble className="size-5" />} change={toStatChange(c?.occupancyPercent, { kind: 'rate' })}
            hint={data && <>{formatCount(data.stats.bookedRoomNights)} of {formatCount(data.stats.availableRoomNights)} room nights booked</>} />
          <MetricTile label="Revenue" value={data?.stats.revenue ?? 0} format={money} loading={loading}
            icon={<Wallet className="size-5" />} change={toStatChange(c?.revenue)} hint="Room charges without GST" />
          <MetricTile label="Average daily rate (ADR)" value={data?.stats.averageDailyRate ?? 0} format={money} loading={loading}
            icon={<IndianRupee className="size-5" />} change={toStatChange(c?.averageDailyRate)} hint="Revenue per room night sold" />
          <MetricTile label="RevPAR" value={data?.stats.revPar ?? 0} format={(value) => formatINR(value, { paise: true })} loading={loading}
            icon={<TrendingUp className="size-5" />} change={toStatChange(c?.revPar)} hint="Revenue per available room night" />
        </MetricGrid>
        {data && (
          <RoomNightsStrip
            items={[
              { label: 'Available room nights', value: formatCount(data.stats.availableRoomNights), hint: 'Rooms for sale on the nights of the range' },
              { label: 'Booked room nights', value: formatCount(data.stats.bookedRoomNights), hint: 'Rooms booked on those nights' },
              { label: 'Sold room nights', value: formatCount(data.stats.roomNights), hint: <SoldChange data={data} /> },
            ]}
          />
        )}
      </Section>

      <div className="grid gap-8 xl:grid-cols-2">
        <Section as="h3" id="bookings" title="Reservations and cancellations" description="Booked or cancelled in the range" className="min-w-0">
          <MetricGrid label="Reservations and cancellations" columns={2} wideLast>
            <MetricTile label="Reservations" value={data?.stats.reservations ?? 0} format={formatCount} loading={loading}
              icon={<CalendarCheck2 className="size-5" />} change={toStatChange(c?.reservations)} hint="Paid reservations booked" />
            <MetricTile label="Cancellations" value={data?.cancellations.count ?? 0} format={formatCount} loading={loading}
              icon={<Ban className="size-5" />} change={toStatChange(c?.cancellations, { upIsGood: false })}
              hint={data && <>By guests {formatCount(data.cancellations.byCustomer)} · by the hotel {formatCount(data.cancellations.byHotel)}</>} />
            <MetricTile label="Cancellation rate" value={data?.cancellations.rate ?? 0} format={formatPercent} loading={loading}
              icon={<Percent className="size-5" />}
              hint={data && <>{plural(data.cancellations.ofBooked, 'reservation', 'reservations')} of {formatCount(data.stats.reservations)} booked in the range cancelled since</>} />
          </MetricGrid>
        </Section>

        <Section as="h3" id="ratings" title="Guest ratings" description="The hotel’s rating now and the reviews of the range" className="min-w-0">
          <MetricGrid label="Guest ratings" columns={2} wideLast>
            <MetricTile label="Guest rating" loading={loading} icon={<Star className="size-5" />}
              value={data?.ratings.guestRating == null ? 'No rating yet' : <>{rating.format(data.ratings.guestRating)}<span className="text-base font-semibold text-slate-500"> / 5</span></>}
              hint={data && plural(data.ratings.reviewCount, 'review', 'reviews')} />
            <MetricTile label="New reviews" value={data?.ratings.newReviews ?? 0} format={formatCount} loading={loading}
              icon={<MessageSquareText className="size-5" />} change={toStatChange(c?.newReviews)}
              hint={data && (data.ratings.averageNewRating == null ? 'Approved in the range' : <>Average {rating.format(data.ratings.averageNewRating)} / 5</>)} />
            <MetricTile label="Waiting for moderation" value={data?.ratings.pendingReviews ?? 0} format={formatCount} loading={loading}
              icon={<Clock3 className="size-5" />} to={`${base}/reviews?status=PENDING`} hint="Reviews an administrator has not checked yet" />
          </MetricGrid>
        </Section>
      </div>
    </div>
  );
}

/**
 * Tonight's rooms (total, still available, booked, stopped from sale) and how the hotel's reservations split by status.
 * Rooms are counted per room type, so these are room counts, not numbered rooms. Hidden for an API without the figures.
 */
function RoomsAndStatus({ today, hotelId }: { today: HotelDashboard['today']; hotelId: string }) {
  const summary = useQuery({
    queryKey: queryKeys.hotelManager.reservationSummary(hotelId, {}),
    queryFn: () => operationsApi.reservationSummary(hotelId, { status: '', dateField: 'CHECK_IN', from: '', to: '', q: '', sort: 'createdAt,desc', page: 0 }),
  });
  const total = today.totalRooms ?? 0;
  const forSale = today.roomsForSale ?? 0;
  const booked = today.roomsBooked ?? 0;
  const available = Math.max(forSale - booked, 0);
  const stopped = Math.max(total - forSale, 0);
  const hasRooms = today.totalRooms !== undefined && total > 0;
  const figures = summary.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2" id="rooms-tonight">
      {hasRooms && (
        <ChartCard as="h3" title="Rooms tonight" description={`${plural(total, 'room', 'rooms')} across the hotel’s room types`}>
          <DonutChart
            title="Rooms tonight"
            valueFormat="count"
            centerLabel="Rooms"
            centerValue={formatCount(total)}
            height={180}
            data={[
              { label: 'Booked', value: booked, color: seriesColor(2) },
              { label: 'Available', value: available, color: seriesColor(1) },
              { label: 'Not for sale', value: stopped, color: seriesColor(5) },
            ]}
          />
        </ChartCard>
      )}
      <ChartCard as="h3" title="Reservations by status" description="Every paid reservation of the hotel, and the ones waiting for payment">
        <DonutChart
          title="Reservations by status"
          valueFormat="count"
          centerLabel="Reservations"
          height={180}
          loading={summary.isPending}
          emptyMessage="No reservations yet"
          data={[
            { label: 'Confirmed', value: figures?.confirmed ?? 0, color: seriesColor(1) },
            { label: 'Checked in', value: figures?.checkedIn ?? 0, color: seriesColor(2) },
            { label: 'Checked out', value: figures?.checkedOut ?? 0, color: seriesColor(3) },
            { label: 'Pending payment', value: figures?.pending ?? 0, color: seriesColor(5) },
            { label: 'Cancelled', value: figures?.cancelled ?? 0, color: seriesColor(4) },
            { label: 'No-show', value: figures?.noShow ?? 0, color: seriesColor(6) },
          ]}
        />
      </ChartCard>
    </div>
  );
}

/** The room nights behind occupancy as one segmented card: a `<dl>`, one column per figure. */
function RoomNightsStrip({ items }: { items: { label: string; value: string; hint: ReactNode }[] }) {
  return (
    <dl className="grid divide-y divide-slate-100 rounded-2xl border border-slate-200/80 bg-white shadow-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 px-5 py-3.5">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</dt>
          <dd className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 tabular-nums">{item.value}</dd>
          <dd className="text-xs text-slate-500">{item.hint}</dd>
        </div>
      ))}
    </dl>
  );
}

function SoldChange({ data }: { data: HotelDashboard }) {
  const change = data.comparison.soldRoomNights;
  if (change.changePercent === null) return <>Rooms sold · none in the previous period</>;
  return <>Rooms sold · previous period {formatCount(change.previous)}</>;
}

function Trends({ data, loading }: { data?: HotelDashboard; loading: boolean }) {
  const interval = data?.interval ?? 'DAY';
  const per = INTERVAL_LABELS[interval].per;
  const common = {
    data: data?.trend ?? [],
    xKey: 'start',
    xFormat: categoryFormat(interval, data?.range),
    xLabel: categoryLabel(interval),
    loading,
  };
  const ratings = (data?.trend ?? []).some((point) => point.guestRating !== null);
  return (
    <Reveal id="trends" className="grid gap-4 lg:grid-cols-2">
      <ChartCard as="h3" title={`Revenue ${per}`} description="Room charges without GST, spread over the nights">
        <BarChart {...common} title={`Revenue ${per}`} valueFormat="inr" series={[{ key: 'revenue', label: 'Revenue' }]}
          emptyMessage="No room revenue in this period" />
      </ChartCard>
      <ChartCard as="h3" title={`Occupancy ${per}`} description="Booked of available room nights">
        <LineChart {...common} title={`Occupancy ${per}`} valueFormat="percent" series={[{ key: 'occupancyPercent', label: 'Occupancy', color: seriesColor(2) }]}
          emptyMessage="No rooms booked in this period" />
      </ChartCard>
      <ChartCard as="h3" title={`ADR and RevPAR ${per}`} description="Average daily rate and revenue per available room night">
        <LineChart {...common} title={`ADR and RevPAR ${per}`} valueFormat="inr"
          series={[{ key: 'averageDailyRate', label: 'ADR' }, { key: 'revPar', label: 'RevPAR' }]}
          emptyMessage="No rooms sold in this period" />
      </ChartCard>
      <ChartCard as="h3" title={`Reservations and cancellations ${per}`} description="By the day they were booked or cancelled">
        <BarChart {...common} title={`Reservations and cancellations ${per}`} valueFormat="count"
          series={[{ key: 'reservations', label: 'Reservations' }, { key: 'cancellations', label: 'Cancellations' }]}
          emptyMessage="No reservations or cancellations in this period" />
      </ChartCard>
      <ChartCard as="h3" title="Cancellations by who cancelled" description="Cancelled in the range">
        <DonutChart
          title="Cancellations by who cancelled"
          valueFormat="count"
          centerLabel="Cancelled"
          loading={loading}
          emptyMessage="No cancellations in this period"
          data={[
            { label: 'By the guest', value: data?.cancellations.byCustomer ?? 0, color: seriesColor(2) },
            { label: 'By the hotel', value: data?.cancellations.byHotel ?? 0, color: seriesColor(4) },
          ]}
        />
      </ChartCard>
      <ChartCard as="h3" title={`Guest rating ${per}`} description="The hotel’s rating at the end of each point">
        {ratings || loading ? (
          <LineChart {...common} title={`Guest rating ${per}`} valueFormat={(value) => rating.format(value)}
            series={[{ key: 'guestRating', label: 'Guest rating', color: seriesColor(3) }]}
            emptyMessage="No rating yet" />
        ) : (
          <EmptyState compact illustration="none" title="No rating yet" description="The rating appears once guests review the hotel." />
        )}
      </ChartCard>
    </Reveal>
  );
}

/** The next week's arrivals: a date tile, the guest (links to the reservation), the stay and the status. */
function UpcomingArrivals({ rows, base }: { rows: ReservationRow[]; base: string }) {
  if (rows.length === 0) {
    return <EmptyState compact illustration="none" title="No arrivals in the next 7 days." />;
  }
  return (
    <ul className="flex flex-col" aria-label="Upcoming arrivals">
      {rows.map((row) => (
        <li key={row.reservationId}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-50">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="flex w-12 shrink-0 flex-col items-center overflow-hidden rounded-xl bg-white text-center shadow-xs ring-1 ring-slate-200">
              <span className="w-full bg-role-600 py-0.5 text-[0.625rem] font-bold uppercase leading-tight tracking-wider text-white">
                {formatShortDate(row.checkIn).split(', ')[0]}
              </span>
              <span className="py-1 text-lg font-bold leading-none text-slate-900">{row.checkIn.slice(8, 10).replace(/^0/, '')}</span>
            </span>
            {row.leadGuest ? <Avatar name={row.leadGuest} size="sm" className="hidden sm:inline-flex" /> : null}
            <div className="min-w-0">
              <Link to={`${base}/reservations/${row.reservationId}`} className="font-semibold text-slate-900 hover:text-role-700 hover:underline">
                {guestLabel(row)}
              </Link>
              <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500">
                <span>{formatShortDate(row.checkIn)}</span>
                <span aria-hidden="true">·</span>
                <span>{row.nights} night{row.nights === 1 ? '' : 's'}</span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <BedDouble className="size-3.5 text-slate-400" aria-hidden="true" />{row.rooms} × {row.roomTypeName ?? 'room'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5 text-slate-400" aria-hidden="true" />{row.adults + row.children}
                  <span className="sr-only"> guest{row.adults + row.children === 1 ? '' : 's'}</span>
                </span>
              </p>
            </div>
          </div>
          <ReservationStatusBadge status={row.status} />
        </li>
      ))}
    </ul>
  );
}
