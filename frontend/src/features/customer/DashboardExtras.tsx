import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight, BedDouble, CreditCard, Star } from 'lucide-react';

import { ChartCard, DonutChart, CHART_SERIES_COLORS } from '@/components/charts';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { homeApi } from '@/features/home/homeApi';
import { NotificationCategoryIcon } from '@/features/notifications/NotificationCategoryIcon';
import { notificationApi } from '@/features/notifications/notificationApi';
import { paymentApi } from '@/features/payments/paymentApi';
import { paymentStatusInfo } from '@/features/payments/paymentStatus';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { CustomerSummary } from './summaryApi';

const HOTEL_COLOR = CHART_SERIES_COLORS[0];
const FLIGHT_COLOR = CHART_SERIES_COLORS[1];

/** The booking-status and hotel-versus-flight donuts, from the summary's own booking counts for the chosen period. */
export function BookingMixCharts({ summary, loading, period }: { summary: CustomerSummary | undefined; loading: boolean; period: string }) {
  const bookings = summary?.bookings;
  return (
    <>
      <ChartCard as="h3" title="Booking status" description={`Where the bookings of ${period} stand now`} className="min-w-0">
        <DonutChart
          title="Bookings by status"
          data={[
            { label: 'Upcoming', value: bookings?.upcoming ?? 0, color: 'var(--color-info-500)' },
            { label: 'Completed', value: bookings?.completed ?? 0, color: 'var(--color-success-500)' },
            { label: 'Cancelled', value: bookings?.cancelled ?? 0, color: 'var(--color-danger-500)' },
          ]}
          valueFormat="count"
          centerLabel="Bookings"
          loading={loading}
          emptyMessage="No bookings in this period"
          height={220}
        />
      </ChartCard>
      <ChartCard as="h3" title="Hotels and flights" description={`How the bookings of ${period} split`} className="min-w-0">
        <DonutChart
          title="Bookings by type"
          data={[
            { label: 'Hotel stays', value: bookings?.hotel ?? 0, color: HOTEL_COLOR },
            { label: 'Flights', value: bookings?.flight ?? 0, color: FLIGHT_COLOR },
          ]}
          valueFormat="count"
          centerLabel="Bookings"
          loading={loading}
          emptyMessage="No bookings in this period"
          height={220}
        />
      </ChartCard>
    </>
  );
}

function CardShell({ id, title, description, action, children }: {
  id: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function RowsLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3">
      <span role="status" className="sr-only">{label}</span>
      {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 rounded-2xl" />)}
    </div>
  );
}

/** The latest payments (the customer's own, newest first). */
export function RecentPayments() {
  const payments = useQuery({
    queryKey: queryKeys.payments.history({ dashboard: true, size: 5 }),
    queryFn: () => paymentApi.history(0, 5),
  });
  return (
    <CardShell
      id="recent-payments"
      title="Recent payments"
      description="Your latest payments and their status."
      action={<ButtonLink to="/account/payments" variant="ghost" size="sm">All payments <ArrowRight className="size-4" aria-hidden="true" /></ButtonLink>}
    >
      {payments.isPending && <RowsLoading label="Loading recent payments…" />}
      {payments.isError && (
        <ErrorState compact title="Recent payments could not be loaded" description={ApiError.from(payments.error).message}
          onRetry={() => void payments.refetch()} />
      )}
      {payments.data && payments.data.content.length === 0 && (
        <EmptyState compact illustration="none" title="No payments yet" description="Payments show up here after you pay for a booking." />
      )}
      {payments.data && payments.data.content.length > 0 && (
        <ul aria-label="Recent payments" className="stagger flex flex-col divide-y divide-slate-100">
          {payments.data.content.map((payment) => {
            const info = paymentStatusInfo[payment.status] ?? { label: payment.status, tone: 'neutral' as const };
            return (
              <li key={payment.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-success-50 text-success-600 ring-1 ring-inset ring-success-200">
                  <CreditCard className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link to={`/account/payments?q=${encodeURIComponent(payment.bookingReference ?? payment.id)}`} className="font-semibold text-slate-900 hover:text-brand-700 hover:underline">
                    {payment.bookingReference ?? 'Booking payment'}
                  </Link>
                  <p className="text-xs text-slate-600">{formatDateTime(payment.createdAt)}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-bold tabular-nums text-slate-900">{formatMoney(payment.amount, payment.currency, true)}</span>
                  <Badge tone={info.tone} dot>{info.label}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
}

/** The latest notifications, unread ones marked; each opens where it points (a booking, a payment, a ticket). */
export function RecentNotifications() {
  const notifications = useQuery({
    queryKey: [...queryKeys.notifications.all, 'dashboard', 5],
    queryFn: () => notificationApi.list(5),
  });
  return (
    <CardShell
      id="recent-notifications"
      title="Recent notifications"
      description="Updates on your bookings, payments and support."
      action={<ButtonLink to="/account/notifications" variant="ghost" size="sm">All notifications <ArrowRight className="size-4" aria-hidden="true" /></ButtonLink>}
    >
      {notifications.isPending && <RowsLoading label="Loading recent notifications…" />}
      {notifications.isError && (
        <ErrorState compact title="Notifications could not be loaded" description={ApiError.from(notifications.error).message}
          onRetry={() => void notifications.refetch()} />
      )}
      {notifications.data && notifications.data.content.length === 0 && (
        <EmptyState compact illustration="none" title="Nothing new" description="Booking, payment and support updates appear here." />
      )}
      {notifications.data && notifications.data.content.length > 0 && (
        <ul aria-label="Recent notifications" className="stagger flex flex-col divide-y divide-slate-100">
          {notifications.data.content.map((item) => {
            const body = (
              <>
                <NotificationCategoryIcon category={item.category} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="truncate">{item.title}</span>
                    {!item.read && <Badge tone="info">New</Badge>}
                  </span>
                  <span className="block truncate text-xs text-slate-600">{item.message}</span>
                  <span className="block text-xs text-slate-500">{formatDateTime(item.createdAt)}</span>
                </span>
              </>
            );
            return (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                {item.link
                  ? <Link to={item.link} className="flex items-start gap-3 rounded-xl hover:bg-slate-50">{body}</Link>
                  : <div className="flex items-start gap-3">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
}

/** Hotels guests rate highest (the same recommendation the home page shows); nothing is shown when there are none. */
export function RecommendedForYou() {
  const hotels = useQuery({
    queryKey: [...queryKeys.publicContent.recommendedHotels, 3],
    queryFn: () => homeApi.recommendedHotels(3),
    staleTime: 5 * 60_000,
  });
  if (hotels.isError || (hotels.data && hotels.data.length === 0)) {
    return null;
  }
  return (
    <CardShell
      id="recommended"
      title="Recommended for your next trip"
      description="Hotels guests rate highest."
      action={<ButtonLink to="/hotels" variant="ghost" size="sm">Search hotels <ArrowRight className="size-4" aria-hidden="true" /></ButtonLink>}
    >
      {hotels.isPending && (
        <div className="grid gap-3 sm:grid-cols-3">
          <span role="status" className="sr-only">Loading recommended hotels…</span>
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-40 rounded-2xl" />)}
        </div>
      )}
      {hotels.data && (
        <ul aria-label="Recommended hotels" className="stagger grid gap-3 sm:grid-cols-3">
          {hotels.data.map((hotel) => (
            <li key={hotel.id}>
              <Link to={`/hotels/${hotel.slug}`} className="group block overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs transition-[transform,box-shadow] duration-(--duration-base) hover:-translate-y-0.5 hover:shadow-lg">
                <div className="relative h-28 bg-gradient-to-br from-brand-50 to-brand-100">
                  {hotel.imageUrl
                    ? <img src={hotel.imageUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    : <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-brand-500"><BedDouble className="size-8" /></span>}
                </div>
                <div className="p-3">
                  <p className="truncate font-semibold text-slate-900 group-hover:text-brand-700">{hotel.name}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-600">
                    <span>{hotel.city}</span>
                    {hotel.guestRating !== null && (
                      <span className="inline-flex items-center gap-0.5 font-semibold text-slate-800">
                        <Star className="size-3 fill-warning-500 text-warning-500" aria-hidden="true" />{hotel.guestRating.toFixed(1)}
                      </span>
                    )}
                  </p>
                  {hotel.priceFrom !== null && <p className="mt-1 text-sm font-bold text-slate-900">From {formatMoney(hotel.priceFrom)}<span className="text-xs font-normal text-slate-500"> / night</span></p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}
