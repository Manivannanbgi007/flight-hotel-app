import { useState } from 'react';
import { BedDouble, Layers, Plane } from 'lucide-react';

import { INTERVAL_LABELS, SegmentedControl, toStatChange } from '@/components/analytics';
import { BarChart, ChartCard, CHART_SERIES_COLORS, formatCount, formatINR, formatPercent } from '@/components/charts';
import { BoardingPassIllustration, HotelIllustration } from '@/components/illustrations';
import { TrendChip } from '@/components/ui/StatCard';
import { cn } from '@/lib/cn';
import { DashSection, ShareBar } from './dashKit';
import { chartBase, share } from './dashHelpers';
import type { AdminDashboard } from './dashboardApi';

type Measure = 'net' | 'gross';

const HOTEL = CHART_SERIES_COLORS[0];
const FLIGHT = CHART_SERIES_COLORS[1];

/**
 * Bookings and revenue by booking type: hotels against flights. Bookings are paid bookings created in the range;
 * revenue is money captured (gross) or what is left after refunds (net) in the range, never a payment that failed or is
 * still pending. The shares are of the two types together. The charts use the interval chosen in the filter bar.
 */
export function TypeSection({ data }: { data?: AdminDashboard }) {
  const [measure, setMeasure] = useState<Measure>('net');
  const loading = !data;
  const hotel = data?.products.hotel;
  const flight = data?.products.flight;
  const bookings = (hotel?.bookings ?? 0) + (flight?.bookings ?? 0);
  const revenueOf = (product: typeof hotel) => (measure === 'net' ? product?.net : product?.gross) ?? 0;
  const revenue = revenueOf(hotel) + revenueOf(flight);
  const per = INTERVAL_LABELS[data?.interval ?? 'DAY'].per;
  const base = { ...chartBase(data), loading };
  const c = data?.comparison;

  return (
    <DashSection
      id="by-type"
      title="Bookings and revenue by booking type"
      description="Hotels against flights: paid bookings created, and money collected, in the range"
      icon={<Layers />}
      accent="blue"
      action={(
        <SegmentedControl<Measure>
          legend="Revenue measure"
          legendHidden
          size="sm"
          value={measure}
          onChange={setMeasure}
          options={[{ value: 'net', label: 'Net revenue' }, { value: 'gross', label: 'Gross revenue' }]}
        />
      )}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <ProductCard
          kind="hotel"
          loading={loading}
          bookings={hotel?.bookings ?? 0}
          revenue={revenueOf(hotel)}
          bookingShare={share(hotel?.bookings ?? 0, bookings)}
          revenueShare={share(revenueOf(hotel), revenue)}
          bookingsChange={c && <TrendChip change={toStatChange(c.hotelBookings)!} />}
          revenueChange={c && <TrendChip change={toStatChange(c.hotelRevenue)!} />}
          footer={hotel && `Gross ${formatINR(hotel.gross)} · refunds ${formatINR(hotel.refunds)}`}
          measure={measure}
        />
        <ProductCard
          kind="flight"
          loading={loading}
          bookings={flight?.bookings ?? 0}
          revenue={revenueOf(flight)}
          bookingShare={share(flight?.bookings ?? 0, bookings)}
          revenueShare={share(revenueOf(flight), revenue)}
          bookingsChange={c && <TrendChip change={toStatChange(c.flightBookings)!} />}
          revenueChange={c && <TrendChip change={toStatChange(c.flightRevenue)!} />}
          footer={flight && `Gross ${formatINR(flight.gross)} · refunds ${formatINR(flight.refunds)}`}
          measure={measure}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard as="h3" title={`Bookings ${per}`} description="Paid bookings by the day they were made, hotels beside flights">
          <BarChart
            {...base}
            title={`Bookings ${per} by booking type`}
            valueFormat="count"
            series={[{ key: 'hotelBookings', label: 'Hotels', color: HOTEL }, { key: 'flightBookings', label: 'Flights', color: FLIGHT }]}
            emptyMessage="No paid bookings in this period"
            height={260}
          />
        </ChartCard>
        <ChartCard as="h3" title={`${measure === 'net' ? 'Net' : 'Gross'} revenue ${per}`}
          description={measure === 'net' ? 'Collected minus refunded, hotels beside flights' : 'Money captured, hotels beside flights'}>
          <BarChart
            {...base}
            title={`${measure === 'net' ? 'Net' : 'Gross'} revenue ${per} by booking type`}
            valueFormat="inr"
            series={measure === 'net'
              ? [{ key: 'hotelNet', label: 'Hotels', color: HOTEL }, { key: 'flightNet', label: 'Flights', color: FLIGHT }]
              : [{ key: 'hotelGross', label: 'Hotels', color: HOTEL }, { key: 'flightGross', label: 'Flights', color: FLIGHT }]}
            emptyMessage="No payments in this period"
            height={260}
          />
        </ChartCard>
      </div>
    </DashSection>
  );
}

function ProductCard({ kind, loading, bookings, revenue, bookingShare, revenueShare, bookingsChange, revenueChange, footer, measure }: {
  kind: 'hotel' | 'flight';
  loading: boolean;
  bookings: number;
  revenue: number;
  bookingShare: number;
  revenueShare: number;
  bookingsChange?: React.ReactNode;
  revenueChange?: React.ReactNode;
  footer?: string;
  measure: Measure;
}) {
  const hotel = kind === 'hotel';
  const Icon = hotel ? BedDouble : Plane;
  const Art = hotel ? HotelIllustration : BoardingPassIllustration;
  return (
    <article
      aria-label={hotel ? 'Hotels' : 'Flights'}
      className={cn(
        'group relative isolate overflow-hidden rounded-2xl border p-5 transition-[transform,box-shadow] duration-(--duration-base) ease-out-soft hover:-translate-y-0.5 hover:shadow-lg',
        hotel ? 'border-brand-200 bg-gradient-to-br from-brand-50 via-white to-white' : 'border-info-200 bg-gradient-to-br from-info-50 via-white to-white',
      )}
    >
      <Art className="pointer-events-none absolute -right-2 -top-3 -z-10 w-32 opacity-25 transition-opacity duration-(--duration-base) group-hover:opacity-50" />
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={cn('flex size-10 items-center justify-center rounded-xl text-white shadow-md', hotel ? 'bg-brand-600' : 'bg-info-600')}>
          <Icon className="size-5" />
        </span>
        <h3 className="text-base font-bold text-slate-900">{hotel ? 'Hotels' : 'Flights'}</h3>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Bookings</dt>
          <dd className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-slate-900">{loading ? '–' : formatCount(bookings)}</dd>
          <dd className="mt-1">{bookingsChange}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">{measure === 'net' ? 'Net revenue' : 'Gross revenue'}</dt>
          <dd className="mt-1 truncate text-3xl font-bold tabular-nums tracking-tight text-slate-900">{loading ? '–' : formatINR(revenue)}</dd>
          <dd className="mt-1">{revenueChange}</dd>
        </div>
      </dl>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="flex items-baseline justify-between text-xs font-medium text-slate-600"><span>Share of bookings</span><span className="font-bold text-slate-900">{formatPercent(bookingShare)}</span></p>
          <ShareBar percent={bookingShare} className="mt-1.5" barClassName={hotel ? undefined : 'from-info-500 to-brand-300'} />
        </div>
        <div>
          <p className="flex items-baseline justify-between text-xs font-medium text-slate-600"><span>Share of revenue</span><span className="font-bold text-slate-900">{formatPercent(revenueShare)}</span></p>
          <ShareBar percent={revenueShare} className="mt-1.5" barClassName={hotel ? 'from-success-500 to-success-200' : 'from-success-600 to-success-200'} />
        </div>
      </div>
      {footer && <p className="mt-3 text-xs text-slate-500">{footer}</p>}
    </article>
  );
}

