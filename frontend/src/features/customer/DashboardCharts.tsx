import { BarChart, CHART_SERIES_COLORS, ChartCard, DonutChart, LineChart } from '@/components/charts';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { BookingMixCharts } from './DashboardExtras';
import type { CustomerSummary, MoneySplit } from './summaryApi';

/** Hotels and flights keep the same colour in every chart of the dashboard (the kit's first two slots). */
const HOTEL_COLOR = CHART_SERIES_COLORS[0];
const FLIGHT_COLOR = CHART_SERIES_COLORS[1];

/**
 * The dashboard's charts, all from the summary's own figures: bookings per month by type (stacked), spending per
 * month (paid, refunded, net), the split of the net spending between hotels and flights, and the same split as a
 * small table of paid, refunded and net per type. The chart kit loads recharts lazily and brings the legend, the
 * tooltip, "Show as table", and the loading and empty states.
 */
export function DashboardCharts({ summary, loading, period, extra }: {
  summary: CustomerSummary | undefined;
  loading: boolean;
  /** One more card in the last row (the recent payments). */
  extra?: React.ReactNode;
  /** "1 Dec 2025 – 6 Nov 2026", for the card descriptions. */
  period: string;
}) {
  const months = summary?.monthlyActivity ?? [];
  const bookingRows = months.map((month) => ({ month: month.month, hotel: month.hotelBookings, flight: month.flightBookings }));
  const moneyRows = months.map((month) => ({ month: month.month, paid: month.paid, refunded: month.refunded, net: month.net }));
  const spending = summary?.spending;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard as="h3" title="Bookings per month" description={`Hotel stays and flights booked, ${period}`} className="min-w-0 lg:col-span-2">
        <BarChart
          title="Bookings per month"
          data={bookingRows}
          xKey="month"
          xFormat="MONTH"
          xLabel="Month"
          valueFormat="count"
          stacked
          series={[
            { key: 'hotel', label: 'Hotel stays', color: HOTEL_COLOR },
            { key: 'flight', label: 'Flights', color: FLIGHT_COLOR },
          ]}
          loading={loading}
          emptyMessage="No bookings in this period"
          height={260}
        />
      </ChartCard>

      <ChartCard as="h3" title="Spending by type" description="Net spending after refunds" className="min-w-0">
        <DonutChart
          title="Net spending by type"
          data={[
            { label: 'Hotel stays', value: spending?.hotel.net ?? 0, color: HOTEL_COLOR },
            { label: 'Flights', value: spending?.flight.net ?? 0, color: FLIGHT_COLOR },
          ]}
          valueFormat="inr"
          centerLabel="Net spent"
          loading={loading}
          emptyMessage="No spending in this period"
          height={220}
        />
      </ChartCard>

      <ChartCard as="h3" title="Spending per month" description={`Paid, refunded and net, ${period}`} className="min-w-0 lg:col-span-2">
        <LineChart
          title="Spending per month"
          data={moneyRows}
          xKey="month"
          xFormat="MONTH"
          xLabel="Month"
          valueFormat="inr"
          series={[
            { key: 'paid', label: 'Paid', color: CHART_SERIES_COLORS[2] },
            { key: 'refunded', label: 'Refunded', color: CHART_SERIES_COLORS[3] },
            { key: 'net', label: 'Net', color: CHART_SERIES_COLORS[6] },
          ]}
          loading={loading}
          emptyMessage="No payments in this period"
          height={260}
        />
      </ChartCard>

      <SpendingSplit hotel={spending?.hotel} flight={spending?.flight} currency={spending?.currency ?? 'INR'} loading={loading} />

      <BookingMixCharts summary={summary} loading={loading} period={period} />
      {extra}
    </div>
  );
}

/** Paid, refunded and net per type: the numbers behind the donut, readable at a glance. */
function SpendingSplit({ hotel, flight, currency, loading }: { hotel?: MoneySplit; flight?: MoneySplit; currency: string; loading: boolean }) {
  const rows = [
    { label: 'Hotel stays', color: HOTEL_COLOR, split: hotel },
    { label: 'Flights', color: FLIGHT_COLOR, split: flight },
  ];
  return (
    <ChartCard as="h3" title="Paid and refunded by type" description="Bookings made in this period" className="min-w-0">
      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ label, color, split }) => (
            <li key={label} className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: color }} />
                {label}
              </p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <Money term="Paid" amount={split?.paid ?? 0} currency={currency} />
                <Money term="Refunded" amount={split?.refunded ?? 0} currency={currency} />
                <Money term="Net" amount={split?.net ?? 0} currency={currency} strong />
              </dl>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

function Money({ term, amount, currency, strong = false }: { term: string; amount: number; currency: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500">{term}</dt>
      <dd className={cn('mt-0.5 truncate tabular-nums', strong ? 'font-bold text-slate-900' : 'font-semibold text-slate-700')}>
        {formatMoney(amount, currency)}
      </dd>
    </div>
  );
}
