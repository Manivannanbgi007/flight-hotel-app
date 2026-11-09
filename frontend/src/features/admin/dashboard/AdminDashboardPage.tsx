import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LayoutDashboard } from 'lucide-react';

import { AnalyticsFilters, analyticsApiParams, describeDays, useAnalyticsQuery } from '@/components/analytics';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { PageHeader } from '@/components/ui/PageHeader';
import { usePollingFallback } from '@/app/providers/useRealtime';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime } from '@/lib/format';
import { LoadError, RequirePermission } from '../shared/adminUi';
import { ActivitySection, RecentBookingsSection } from './ActivitySections';
import { CancellationsSection } from './CancellationsSection';
import { CustomersSection } from './CustomersSection';
import { PaymentsSection } from './PaymentsSection';
import { DestinationsSection, HotelsSection } from './PlacesSections';
import { RevenueBand } from './RevenueBand';
import { StatusSection } from './StatusSection';
import { TypeSection } from './TypeSection';
import { dashboardApi } from './dashboardApi';

/**
 * /admin — the admin dashboard v2 (api-analytics §2): revenue, bookings, payments, cancellations and customers for a
 * range, each against the previous period of the same length; trends per day, week, month or year; top lists and the
 * latest activity. Range and interval live in the URL. Updates live (`dashboard.updated`).
 */
export function AdminDashboardPage() {
  return (
    <RequirePermission permission="REPORT_VIEW">
      <Dashboard />
    </RequirePermission>
  );
}

function Dashboard() {
  const [query, setQuery] = useAnalyticsQuery();
  const fallback = usePollingFallback(60_000);
  const dashboard = useQuery({
    queryKey: queryKeys.admin.dashboardRange(analyticsApiParams(query)),
    queryFn: () => dashboardApi.get(query),
    placeholderData: keepPreviousData,
    refetchInterval: fallback,
  });
  const data = dashboard.data;
  const problem = dashboard.isError ? ApiError.from(dashboard.error) : null;
  const updating = dashboard.isFetching && dashboard.isPlaceholderData;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin portal"
        title="Dashboard"
        icon={<LayoutDashboard className="size-5" />}
        description={data
          ? <>Figures for {describeDays(data.range)} (India time), compared with {describeDays(data.previousRange)}. Updated {formatDateTime(data.generatedAt)}.</>
          : 'Bookings, revenue, payments, cancellations and customers at a glance.'}
        actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>}
      />

      <AnalyticsFilters
        key={JSON.stringify(query)}
        value={query}
        onChange={setQuery}
        served={data ? { range: data.range, interval: data.interval, previousRange: data.previousRange } : null}
        busy={updating}
      />

      {problem?.code === 'INVALID_INTERVAL' ? (
        <Alert tone="warning" title="This interval does not fit the range">
          <p>{problem.message}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setQuery({ ...query, interval: null })}>
            Choose the interval automatically
          </Button>
        </Alert>
      ) : problem && !data ? (
        <LoadError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : problem && (
        <Alert tone="danger" title="The new figures could not be loaded; these are the previous ones">
          <p>{problem.message}</p>
          {problem.correlationId && <p className="text-xs">Support reference: {problem.correlationId}</p>}
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void dashboard.refetch()}>Try again</Button>
        </Alert>
      )}

      {(dashboard.isPending || data) && (
        <div className="flex flex-col gap-6" aria-busy={updating || dashboard.isPending || undefined}>
          <RevenueBand data={data} />
          <TypeSection data={data} />
          <StatusSection data={data} />
          <CustomersSection data={data} />
          <PaymentsSection data={data} />
          <CancellationsSection data={data} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
            <DestinationsSection data={data} />
            <HotelsSection data={data} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <RecentBookingsSection data={data} />
            <ActivitySection data={data} />
          </div>
        </div>
      )}
    </div>
  );
}
