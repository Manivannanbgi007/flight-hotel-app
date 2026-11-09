import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  BedDouble, CalendarClock, CircleCheckBig, CircleX, Hourglass, IndianRupee, Loader2, Plane, RotateCcw, Ticket, Wallet,
} from 'lucide-react';

import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/app/providers/useAuth';
import { paymentApi } from '@/features/payments/paymentApi';
import { queryKeys } from '@/lib/api/queryKeys';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button, ButtonLink } from '@/components/ui/Button';
import { PageHeader, Section } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { ErrorState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { formatMoney } from '@/lib/format';
import { DashboardCharts } from './DashboardCharts';
import { RecentNotifications, RecentPayments, RecommendedForYou } from './DashboardExtras';
import { HowItWorks, QuickActions, RecentBookings, WelcomePanel } from './DashboardParts';
import { NextTripCard, NextTripSkeleton, NoNextTrip } from './NextTripCard';
import { RangeFilter } from './RangeFilter';
import type { SummaryParams } from './summaryApi';
import { DEFAULT_PRESET, formatPeriod, rangeFromSearch, rangeToSearch, statChangeOf } from './summaryRange';
import { isFirstTimeCustomer, useCustomerSummary } from './useCustomerSummary';

const money = (value: number) => formatMoney(value);
const COMPARED = 'vs previous period';

/**
 * `/customer/dashboard`, where customers land after signing in (IMPLEMENTATION_PLAN.md §11.2–11.3): the next trip,
 * shortcuts, the trips as they are now, and for the chosen period (kept in the URL) the bookings and spending with
 * their change against the period before, charts per month and by type, and the latest bookings. Every figure comes
 * from `GET /api/bookings/summary` and My Trips; a customer who has never booked gets an invitation instead.
 */
export function CustomerDashboardPage() {
  const { user } = useAuth();
  const [search, setSearch] = useSearchParams();
  const params = rangeFromSearch(search);
  const { current, previousRange, comparisons } = useCustomerSummary(params);
  const summary = current.data;
  const loading = current.isPending;
  const updating = current.isFetching && current.isPlaceholderData;
  const setRange = (next: SummaryParams) => setSearch(rangeToSearch(next, search));

  const header = (
    <PageHeader
      eyebrow="My dashboard"
      title={`Welcome, ${user?.firstName ?? 'traveller'}`}
      description="Your next trip, your bookings and your spending, in one place."
      actions={
        <>
          <ButtonLink to="/flights"><Plane className="size-4" aria-hidden="true" />Search flights</ButtonLink>
          <ButtonLink to="/hotels" variant="secondary"><BedDouble className="size-4" aria-hidden="true" />Search hotels</ButtonLink>
        </>
      }
    />
  );

  if (current.isError) {
    const problem = ApiError.from(current.error);
    const badRange = problem.code === 'INVALID_RANGE';
    return (
      <PageContainer>
        {header}
        <ErrorState
          className="mt-8"
          title={badRange ? 'This period cannot be shown' : 'Your dashboard could not be loaded'}
          description={problem.message}
          correlationId={problem.correlationId}
          onRetry={badRange ? undefined : () => void current.refetch()}
        />
        {badRange && (
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" onClick={() => setRange({ range: DEFAULT_PRESET })}>Show the last 12 months</Button>
          </div>
        )}
      </PageContainer>
    );
  }

  if (summary && isFirstTimeCustomer(summary)) {
    return (
      <PageContainer>
        {header}
        <div className="mt-8 flex flex-col gap-8">
          <WelcomePanel />
          <QuickActions layout="grid" />
          <HowItWorks />
        </div>
      </PageContainer>
    );
  }

  const period = summary ? formatPeriod(summary.range) : '';
  const change = (comparison: Parameters<typeof statChangeOf>[0], options: Parameters<typeof statChangeOf>[1] = {}) =>
    statChangeOf(comparison, { period: COMPARED, ...options });

  return (
    <PageContainer>
      {header}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {loading ? <NextTripSkeleton /> : summary?.nextTrip ? <NextTripCard trip={summary.nextTrip} /> : <NoNextTrip />}
        </div>
        <QuickActions />
      </div>

      <Section
        id="trips"
        title="Your trips"
        description="All your trips as they are now."
        className="mt-10"
        actions={<ButtonLink to="/my-trips" variant="secondary" size="sm">Open My Trips</ButtonLink>}
      >
        <ul aria-label="Trip figures" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger">
          <li><StatCard className="h-full" label="Upcoming trips" value={summary?.trips.upcoming ?? 0} loading={loading} to="/my-trips?tab=UPCOMING" icon={<CalendarClock className="size-5" />} /></li>
          <li><StatCard className="h-full" label="Completed trips" value={summary?.trips.completed ?? 0} loading={loading} to="/my-trips?tab=COMPLETED" icon={<CircleCheckBig className="size-5" />} /></li>
          <li><StatCard className="h-full" label="Cancelled trips" value={summary?.trips.cancelled ?? 0} loading={loading} to="/my-trips?tab=CANCELLED" icon={<CircleX className="size-5" />} /></li>
          <li><PendingPaymentsCard /></li>
        </ul>
        {!!summary?.trips.pending && (
          <p className="flex flex-wrap items-center gap-2 rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
            <Hourglass className="size-4" aria-hidden="true" />
            {summary.trips.pending === 1 ? '1 booking is' : `${summary.trips.pending} bookings are`} waiting for payment or confirmation.
            <Link to="/my-trips?tab=PENDING" className="font-semibold underline underline-offset-2 hover:no-underline">See pending bookings</Link>
          </p>
        )}
      </Section>

      <Section
        id="insights"
        title="Your travel at a glance"
        description={summary ? <PeriodLine period={period} previous={previousRange ? formatPeriod(previousRange) : null} /> : 'Bookings and spending for the period you choose.'}
        className="mt-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <RangeFilter key={`${params.from ?? ''}-${params.to ?? ''}`} value={params} onChange={setRange} />
          {updating && (
            <p role="status" className="flex items-center gap-2 text-sm font-medium text-slate-600">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />Updating the figures…
            </p>
          )}
        </div>

        <div aria-busy={updating || undefined} className="flex flex-col gap-6">
          <KpiGroup id="kpi-bookings" title="Bookings" description="Paid and confirmed bookings made in this period.">
            <li>
              <StatCard className="h-full" label="Bookings" value={summary?.bookings.total ?? 0} loading={loading} icon={<Ticket className="size-5" />}
                change={change(comparisons?.bookings ?? null)}
                footer={summary && summary.bookings.total > 0
                  ? `${summary.bookings.upcoming} upcoming · ${summary.bookings.completed} completed · ${summary.bookings.cancelled} cancelled`
                  : undefined} />
            </li>
            <li>
              <StatCard className="h-full" label="Hotel stays" value={summary?.bookings.hotel ?? 0} loading={loading} icon={<BedDouble className="size-5" />}
                change={change(comparisons?.hotel ?? null)} />
            </li>
            <li>
              <StatCard className="h-full" label="Flights" value={summary?.bookings.flight ?? 0} loading={loading} icon={<Plane className="size-5" />}
                change={change(comparisons?.flight ?? null)} />
            </li>
          </KpiGroup>

          <KpiGroup id="kpi-spending" title="Spending" description="What you paid for the bookings made in this period, and what came back."
            wide={!!summary?.spending.refundsInProgress}>
            <li>
              <StatCard className="h-full" label="Paid" value={summary?.spending.paid ?? 0} format={money} loading={loading} icon={<Wallet className="size-5" />}
                change={change(comparisons?.paid ?? null, { neutral: true })} />
            </li>
            <li>
              <StatCard className="h-full" label="Refunded" value={summary?.spending.refunded ?? 0} format={money} loading={loading} icon={<RotateCcw className="size-5" />}
                change={change(comparisons?.refunded ?? null, { neutral: true })} />
            </li>
            <li>
              <StatCard className="h-full" label="Net spending" value={summary?.spending.net ?? 0} format={money} loading={loading} icon={<IndianRupee className="size-5" />}
                change={change(comparisons?.net ?? null, { neutral: true })} footer={summary ? 'Paid minus refunded' : undefined} />
            </li>
            {!!summary?.spending.refundsInProgress && (
              <li>
                <StatCard className="h-full" label="Refunds in progress" value={summary.spending.refundsInProgress} format={money} icon={<Hourglass className="size-5" />}
                  footer="On the way back to your payment method" />
              </li>
            )}
          </KpiGroup>

          <DashboardCharts summary={summary} loading={loading} period={period} extra={<RecentPayments />} />
        </div>
      </Section>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <RecentBookings />
        <RecentNotifications />
      </div>

      <div className="mt-10">
        <RecommendedForYou />
      </div>
    </PageContainer>
  );
}

/** "1 Dec 2025 – 6 Nov 2026 · compared with 25 Dec 2024 – 30 Nov 2025". */
function PeriodLine({ period, previous }: { period: string; previous: string | null }) {
  return (
    <>
      <span className="font-semibold text-slate-700">{period}</span>
      {previous ? <> · changes compared with {previous}</> : <> · no earlier period to compare with</>}
    </>
  );
}

function KpiGroup({ id, title, description, wide = false, children }: {
  id: string;
  title: string;
  description: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <div>
        <h3 id={`${id}-title`} className="text-base font-bold tracking-tight text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600">{description}</p>
      </div>
      <ul aria-label={`${title} figures`} className={wide ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4' : 'grid gap-4 sm:grid-cols-3'}>
        {children}
      </ul>
    </section>
  );
}

/** Payments still open with the provider (the payment service's own count for this customer). */
function PendingPaymentsCard() {
  const summary = useQuery({
    queryKey: queryKeys.payments.summary({ dashboard: true }),
    queryFn: () => paymentApi.historySummary(),
  });
  return (
    <StatCard className="h-full" label="Pending payments" value={summary.data?.pending ?? 0} loading={summary.isPending}
      to="/account/payments" icon={<Hourglass className="size-5" />}
      footer={summary.isError ? 'Could not be loaded' : 'Waiting for the payment provider'} />
  );
}
