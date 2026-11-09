import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { BedDouble, Hotel, MapPin, Star, TrendingUp } from 'lucide-react';

import { formatCount, formatINR } from '@/components/charts';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/StateViews';
import { hotelApi } from '@/features/hotels/hotelApi';
import { queryKeys } from '@/lib/api/queryKeys';
import { countryName } from '@/lib/countries';
import { cn } from '@/lib/cn';
import { DashSection, ShareBar, Trend, ViewAll } from './dashKit';
import type { AdminDashboard } from './dashboardApi';

/** Soft, travel-like gradients for destination tiles; the same city always gets the same one. */
const TILES = [
  'from-info-500 to-brand-700', 'from-success-500 to-info-600', 'from-accent-400 to-warning-600',
  'from-role-500 to-brand-700', 'from-brand-400 to-role-600', 'from-warning-500 to-danger-500',
];
const tileFor = (name: string) => {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TILES[hash % TILES.length]!;
};

function Rank({ index }: { index: number }) {
  return (
    <span aria-label={`Rank ${index + 1}`} className={cn(
      'absolute left-1.5 top-1.5 z-10 flex size-6 items-center justify-center rounded-full text-xs font-bold shadow-sm ring-1 ring-white/70',
      index === 0 ? 'bg-warning-500 text-white' : 'bg-white/90 text-slate-700',
    )}>
      {index + 1}
    </span>
  );
}

function RowsLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3">
      <span role="status" className="sr-only">{label}</span>
      {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-20 rounded-2xl" />)}
    </div>
  );
}

/**
 * Popular destinations: the cities with the most paid bookings in the range, each with its bookings, revenue (net of
 * refunds), a bar against the busiest city and the trend against the previous period. The country comes from the hotel
 * catalogue when the city has hotels there; otherwise only the city is shown.
 */
export function DestinationsSection({ data }: { data?: AdminDashboard }) {
  const cities = data?.popularDestinations ?? [];
  const countries = useQueries({
    queries: cities.map((destination) => ({
      queryKey: queryKeys.hotels.destinations(destination.city),
      queryFn: () => hotelApi.destinations(destination.city),
      staleTime: 30 * 60_000,
      retry: false,
    })),
  });
  const top = Math.max(1, ...cities.map((destination) => destination.bookings));
  return (
    <DashSection
      id="popular-destinations"
      title="Popular destinations"
      description="Cities with the most paid bookings in the range"
      icon={<MapPin />}
      accent="blue"
      className="h-full"
    >
      {!data && <RowsLoading label="Loading popular destinations…" />}
      {data && cities.length === 0 && (
        <EmptyState compact illustration="none" title="Nothing in this range" description="Choose a longer range to see more." />
      )}
      {data && cities.length > 0 && (
        <ol aria-label="Popular destinations" className="stagger flex flex-col gap-3">
          {cities.map((destination, index) => {
            const match = countries[index]?.data?.find((item) => item.city.toLowerCase() === destination.city.toLowerCase());
            const country = match ? countryName(match.countryCode) : '';
            return (
              <li key={destination.city} className="group flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-3 transition-[transform,box-shadow,border-color] duration-(--duration-base) ease-out-soft hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg">
                <div className={cn('relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br text-white', tileFor(destination.city))}>
                  <Rank index={index} />
                  <MapPin aria-hidden="true" className="size-9 opacity-90 transition-transform duration-500 group-hover:-translate-y-1 group-hover:scale-110" />
                  <span aria-hidden="true" className="absolute -bottom-6 -right-6 size-16 rounded-full bg-white/15" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-slate-900">{destination.city}</p>
                  {country && <p className="truncate text-xs font-medium text-slate-500">{country}</p>}
                  <ShareBar percent={(destination.bookings / top) * 100} className="mt-2" />
                  <p className="mt-1 text-xs text-slate-500">Against the busiest city</p>
                </div>
                <dl className="shrink-0 text-right">
                  <dt className="sr-only">Bookings</dt>
                  <dd className="text-lg font-bold tabular-nums text-slate-900">{formatCount(destination.bookings)}<span className="ml-1 text-xs font-medium text-slate-500">bookings</span></dd>
                  <dt className="sr-only">Revenue</dt>
                  <dd className="text-sm font-semibold tabular-nums text-success-700">{formatINR(destination.revenue)}</dd>
                  <dd className="mt-1 flex justify-end"><Trend current={destination.bookings} previous={destination.previousBookings} /></dd>
                </dl>
              </li>
            );
          })}
        </ol>
      )}
    </DashSection>
  );
}

/**
 * Top hotels by revenue in the range: the hotel's first photo and guest rating come from the hotel catalogue (a rating
 * is only shown when the hotel has one), the bookings, revenue and trend from the booking facts.
 */
export function HotelsSection({ data }: { data?: AdminDashboard }) {
  const hotels = data?.topHotels ?? [];
  return (
    <DashSection
      id="top-hotels"
      title="Top hotels"
      description="Hotels earning the most in the range"
      icon={<Hotel />}
      accent="purple"
      className="h-full"
      action={<ViewAll to="/admin/hotels" label="All hotels" permission="HOTEL_MANAGE_ANY" />}
    >
      {!data && <RowsLoading label="Loading top hotels…" />}
      {data && hotels.length === 0 && (
        <EmptyState compact illustration="none" title="Nothing in this range" description="Choose a longer range to see more." />
      )}
      {data && hotels.length > 0 && (
        <ol aria-label="Top hotels" className="stagger flex flex-col gap-3">
          {hotels.map((hotel, index) => <HotelRow key={hotel.hotelId} hotel={hotel} index={index} />)}
        </ol>
      )}
    </DashSection>
  );
}

function HotelRow({ hotel, index }: { hotel: AdminDashboard['topHotels'][number]; index: number }) {
  const details = useQuery({
    queryKey: queryKeys.hotels.details(hotel.hotelId),
    queryFn: () => hotelApi.details(hotel.hotelId),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const image = details.data?.images?.[0];
  const rating = details.data?.guestRating ?? null;
  return (
    <li className="group flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-3 transition-[transform,box-shadow,border-color] duration-(--duration-base) ease-out-soft hover:-translate-y-0.5 hover:border-role-200 hover:shadow-lg">
      <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 ring-1 ring-inset ring-brand-100">
        <Rank index={index} />
        {image ? (
          <img src={image.thumbUrl || image.url} alt={hotel.hotelName} loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-110" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-brand-500"><BedDouble role="img" aria-label="Hotel" className="size-8" /></span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Link to={`/admin/hotels?q=${encodeURIComponent(hotel.hotelName)}`} className="block truncate text-base font-bold text-slate-900 hover:text-role-700 hover:underline">
          {hotel.hotelName}
        </Link>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden="true" />{hotel.city}</span>
          {rating !== null && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-slate-800">
              <Star className="size-3 fill-warning-500 text-warning-500" aria-hidden="true" />{rating.toFixed(1)}
              {!!details.data?.reviewCount && <span className="font-normal text-slate-500"> ({formatCount(details.data.reviewCount)})</span>}
            </span>
          )}
        </p>
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500"><TrendingUp className="size-3" aria-hidden="true" /><Trend current={hotel.bookings} previous={hotel.previousBookings} /></p>
      </div>
      <dl className="shrink-0 text-right">
        <dt className="sr-only">Revenue</dt>
        <dd className="text-lg font-bold tabular-nums text-success-700">{formatINR(hotel.revenue)}</dd>
        <dt className="sr-only">Bookings</dt>
        <dd className="text-xs font-medium text-slate-600">{formatCount(hotel.bookings)} {hotel.bookings === 1 ? 'booking' : 'bookings'}</dd>
      </dl>
    </li>
  );
}
