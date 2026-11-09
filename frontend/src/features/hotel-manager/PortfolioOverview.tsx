import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  BedDouble, Building2, CalendarCheck2, DoorOpen, Hotel, LogIn, LogOut, MessageSquare, Percent, TrendingUp, Wallet,
} from 'lucide-react';

import { analyticsApiParams, DEFAULT_ANALYTICS_QUERY } from '@/components/analytics/range';
import { categoryFormat, categoryLabel, INTERVAL_LABELS } from '@/components/analytics';
import { toStatChange } from '@/components/analytics/growth';
import { AreaChart, BarChart, ChartCard, formatCount, formatINR, formatPercent, LineChart } from '@/components/charts';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/StateViews';
import { DashSection } from '@/features/admin/dashboard/dashKit';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDate } from '@/lib/format';
import { RatingStars } from './ManagerParts';
import { operationsApi } from './operationsApi';
import type { ManagerReview, ReservationSummary } from './operationsTypes';
import type { HotelSummary } from './types';
import { limited } from './useHotelDashboard';

const ALL_RESERVATIONS = { status: '', dateField: 'CHECK_IN', from: '', to: '', q: '', sort: 'createdAt,desc', page: 0 } as const;
const sum = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);

/**
 * The overview of every hotel a manager is assigned to: rooms, arrivals and departures today, occupancy tonight,
 * reservations and revenue of the last 30 days (each hotel's own dashboard, added up), reservations waiting for payment,
 * the trend of the portfolio and the newest published reviews. Every number is a sum of hotel figures from the server; a
 * hotel whose figures cannot be loaded is simply left out of the sums, and the page says so.
 */
export function PortfolioOverview({ hotels }: { hotels: HotelSummary[] }) {
  const dashboards = useQueries({
    queries: hotels.map((hotel) => ({
      // The same cache entry as the hotel's own dashboard and its card below.
      queryKey: queryKeys.hotelManager.dashboardRange(hotel.id, analyticsApiParams(DEFAULT_ANALYTICS_QUERY)),
      queryFn: () => limited(() => operationsApi.dashboard(hotel.id, DEFAULT_ANALYTICS_QUERY)),
      staleTime: 60_000,
    })),
  });
  const summaries = useQueries({
    queries: hotels.map((hotel) => ({
      queryKey: queryKeys.hotelManager.reservationSummary(hotel.id, { portfolio: true }),
      queryFn: () => limited(() => operationsApi.reservationSummary(hotel.id, { ...ALL_RESERVATIONS })),
      staleTime: 60_000,
    })),
  });
  const reviews = useQueries({
    queries: hotels.map((hotel) => ({
      queryKey: queryKeys.hotelManager.reviewList(hotel.id, { portfolio: true }),
      queryFn: () => limited(() => operationsApi.reviews(hotel.id, { status: 'APPROVED', page: 0 }, 3)),
      staleTime: 60_000,
    })),
  });

  const loaded = dashboards.flatMap((query, index) => (query.data ? [{ hotel: hotels[index]!, data: query.data }] : []));
  const loading = dashboards.some((query) => query.isPending);
  const missing = dashboards.filter((query) => query.isError).length;
  const data = loaded.map((entry) => entry.data);
  const pending = summaries.flatMap((query) => (query.data ? [query.data as ReservationSummary] : []));

  const rooms = sum(hotels, (hotel) => hotel.totalRooms ?? 0);
  const forSale = sum(data, (d) => d.today.roomsForSale ?? 0);
  const booked = sum(data, (d) => d.today.roomsBooked ?? 0);
  const haveRooms = data.some((d) => d.today.roomsForSale !== undefined);
  const occupancy = haveRooms ? (forSale > 0 ? (booked / forSale) * 100 : 0)
    : (data.length ? sum(data, (d) => d.today.occupancyPercent) / data.length : 0);
  const revenue = sum(data, (d) => d.stats.revenue);
  const previousRevenue = sum(data, (d) => d.comparison.revenue.previous);
  const revenueChange = data.length ? toStatChange({
    current: revenue, previous: previousRevenue, change: revenue - previousRevenue,
    changePercent: previousRevenue === 0 ? null : ((revenue - previousRevenue) / previousRevenue) * 100,
    trend: revenue > previousRevenue ? 'UP' : revenue < previousRevenue ? 'DOWN' : 'FLAT',
  }, { period: 'vs previous 30 days' }) : undefined;

  // The portfolio's trend: the hotels' points added up (every hotel is asked for the same range and interval).
  const interval = data[0]?.interval ?? 'DAY';
  const points = new Map<string, { start: string; revenue: number; reservations: number; cancellations: number; available: number; booked: number }>();
  for (const dashboard of data) {
    for (const point of dashboard.trend) {
      const row = points.get(point.start) ?? { start: point.start, revenue: 0, reservations: 0, cancellations: 0, available: 0, booked: 0 };
      row.revenue += point.revenue;
      row.reservations += point.reservations;
      row.cancellations += point.cancellations;
      row.available += point.availableRoomNights;
      row.booked += point.bookedRoomNights;
      points.set(point.start, row);
    }
  }
  const series = [...points.values()].sort((a, b) => a.start.localeCompare(b.start))
    .map((row) => ({ ...row, occupancy: row.available > 0 ? Math.round((row.booked / row.available) * 1000) / 10 : 0 }));
  const common = { data: series, xKey: 'start', xFormat: categoryFormat(interval, data[0]?.range), xLabel: categoryLabel(interval), loading };
  const per = INTERVAL_LABELS[interval].per;

  const recent = reviews
    .flatMap((query, index) => (query.data ? query.data.content.map((review) => ({ review, hotel: hotels[index]! })) : []))
    .sort((a, b) => b.review.createdAt.localeCompare(a.review.createdAt))
    .slice(0, 4);
  const ratedHotels = data.filter((d) => d.ratings.guestRating !== null);
  const money = (value: number) => formatINR(value);

  return (
    <div className="flex flex-col gap-6">
      {missing > 0 && (
        <p role="status" className="rounded-xl bg-warning-50 px-4 py-2.5 text-sm text-warning-700 ring-1 ring-inset ring-warning-200">
          The figures of {missing === 1 ? '1 hotel' : `${missing} hotels`} could not be loaded, so the totals below leave {missing === 1 ? 'it' : 'them'} out.
        </p>
      )}

      <ul aria-label="Portfolio figures" className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
        <li><StatCard className="h-full" label="Managed hotels" value={hotels.length} format={formatCount} icon={<Building2 className="size-5" />}
          footer={`${hotels.filter((hotel) => hotel.status === 'ACTIVE').length} published`} /></li>
        <li><StatCard className="h-full" label="Total rooms" value={rooms} format={formatCount} icon={<BedDouble className="size-5" />}
          footer={`In ${formatCount(sum(hotels, (hotel) => hotel.roomTypes))} room types on sale`} /></li>
        <li><StatCard className="h-full" label="Reservations, 30 days" value={sum(data, (d) => d.stats.reservations)} format={formatCount} loading={loading}
          icon={<CalendarCheck2 className="size-5" />} footer="Paid reservations booked" /></li>
        <li><StatCard className="h-full" label="Revenue, 30 days" value={revenue} format={money} loading={loading} icon={<Wallet className="size-5" />}
          change={revenueChange} footer="Room charges without GST" /></li>
        <li><StatCard className="h-full" label="Check-ins today" value={sum(data, (d) => d.today.arrivals)} format={formatCount} loading={loading}
          icon={<LogIn className="size-5" />} footer={`${formatCount(sum(data, (d) => d.upcomingArrivals.length))} more in the next 7 days`} /></li>
        <li><StatCard className="h-full" label="Check-outs today" value={sum(data, (d) => d.today.departures)} format={formatCount} loading={loading}
          icon={<LogOut className="size-5" />} footer={`${formatCount(sum(data, (d) => d.today.inHouseGuests))} guests in house`} /></li>
        <li><StatCard className="h-full" label="Occupancy tonight" value={occupancy} format={formatPercent} loading={loading}
          icon={<Percent className="size-5" />} footer={haveRooms ? `${formatCount(booked)} of ${formatCount(forSale)} rooms for sale booked` : 'Average of your hotels'} /></li>
        <li><StatCard className="h-full" label="Waiting for payment" value={sum(pending, (summary) => summary.pending)} format={formatCount}
          loading={summaries.some((query) => query.isPending)} icon={<DoorOpen className="size-5" />}
          footer={`${formatCount(sum(data, (d) => d.ratings.pendingReviews))} reviews waiting for approval`} /></li>
      </ul>

      <DashSection id="portfolio-trends" title="Portfolio trends" description="The last 30 days of all your hotels together" icon={<TrendingUp />} accent="purple">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
          <ChartCard as="h3" title={`Revenue ${per}`} description="Room charges without GST">
            <AreaChart {...common} title={`Portfolio revenue ${per}`} valueFormat="inr" series={[{ key: 'revenue', label: 'Revenue', color: 'var(--color-role-500)' }]}
              emptyMessage="No room revenue in this period" height={240} />
          </ChartCard>
          <ChartCard as="h3" title={`Reservations and cancellations ${per}`} description="Booked or cancelled on each day">
            <BarChart {...common} title={`Portfolio reservations and cancellations ${per}`} valueFormat="count"
              series={[{ key: 'reservations', label: 'Reservations', color: 'var(--color-brand-500)' }, { key: 'cancellations', label: 'Cancellations', color: 'var(--color-danger-500)' }]}
              emptyMessage="No reservations in this period" height={240} />
          </ChartCard>
          <ChartCard as="h3" title={`Occupancy ${per}`} description="Rooms booked of rooms for sale, all hotels together" className="xl:col-span-2">
            <LineChart {...common} title={`Portfolio occupancy ${per}`} valueFormat="percent" series={[{ key: 'occupancy', label: 'Occupancy', color: 'var(--color-success-500)' }]}
              emptyMessage="No rooms booked in this period" height={220} />
          </ChartCard>
        </div>
      </DashSection>

      <DashSection id="recent-reviews" title="Recent guest reviews" icon={<MessageSquare />} accent="orange"
        description={ratedHotels.length > 0 ? `${ratedHotels.length === 1 ? 'Rating' : 'Ratings'}: ${ratedHotels.map((d) => `${d.hotelName ?? ''} ${d.ratings.guestRating!.toFixed(1)}`.trim()).join(' · ')}` : 'The newest published reviews'}>
        {reviews.some((query) => query.isPending) && recent.length === 0 && <span role="status" className="sr-only">Loading reviews…</span>}
        {recent.length === 0 && !reviews.some((query) => query.isPending) && (
          <EmptyState compact illustration="none" title="No published reviews yet" description="Reviews appear here once guests write about their stay." />
        )}
        {recent.length > 0 && (
          <ul aria-label="Recent reviews" className="stagger grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
            {recent.map(({ review, hotel }) => <RecentReview key={review.id} review={review} hotel={hotel} />)}
          </ul>
        )}
      </DashSection>
    </div>
  );
}

function RecentReview({ review, hotel }: { review: ManagerReview; hotel: HotelSummary }) {
  return (
    <li className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition-[transform,box-shadow] duration-(--duration-base) ease-out-soft hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RatingStars rating={review.rating} />
        <Link to={`/hotel-manager/hotels/${hotel.id}/reviews`} className="inline-flex items-center gap-1 text-xs font-semibold text-role-700 hover:underline">
          <Hotel className="size-3.5" aria-hidden="true" />{hotel.name}
        </Link>
      </div>
      <p className="mt-2 break-words font-semibold text-slate-900">{review.title}</p>
      <p className="line-clamp-2 break-words text-sm text-slate-700">{review.text}</p>
      <p className="mt-2 text-xs text-slate-500">{review.authorName ?? 'Guest'} · {formatDate(review.createdAt)}</p>
    </li>
  );
}
