import { useId, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock3, Flag, Headset, Inbox, LifeBuoy, Loader, MessageCircleReply, Timer, UserCheck,
  UserX, type LucideIcon,
} from 'lucide-react';

import {
  AnalyticsFilters, analyticsApiParams, categoryFormat, categoryLabel, INTERVAL_LABELS, KpiGrid, KpiItem, toStatChange,
  useAnalyticsQuery,
} from '@/components/analytics';
import { BarChart, ChartCard, formatCount, seriesColor } from '@/components/charts';
import { Reveal } from '@/components/motion/Reveal';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Section } from '@/components/ui/PageHeader';
import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { useAuth } from '@/app/providers/useAuth';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { ErrorState } from '@/components/ui/StateViews';
import { TICKET_CATEGORIES, TICKET_STATUSES } from '@/features/tickets/ticketText';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { agentTicketApi } from './agentTicketApi';
import { formatHours, formatMinutes } from './durations';
import { supportApi } from './supportApi';
import { supportMetricsApi, type SupportMetrics } from './supportMetricsApi';
import { agentCategoryLabel, agentStatusLabel } from './ticketQueueText';
import { SupportHero } from './SupportKit';
import type { SupportBookingFilters, SupportSummary } from './types';

/** The "Needs attention" queue, asked only for its size. */
const ATTENTION: SupportBookingFilters = { q: '', status: '', type: '', attention: true, page: 0 };

type TileTone = 'role' | 'warning' | 'danger' | 'info' | 'success';

const TICKET_TILES: readonly { key: keyof SupportSummary; label: string; to: string; icon: LucideIcon; tone: TileTone }[] = [
  { key: 'open', label: 'Open', to: '/support/tickets?status=OPEN', icon: Inbox, tone: 'warning' },
  { key: 'inProgress', label: 'In progress', to: '/support/tickets?status=IN_PROGRESS', icon: Loader, tone: 'info' },
  { key: 'waitingCustomer', label: 'Waiting for customer', to: '/support/tickets?status=WAITING_CUSTOMER', icon: Clock3, tone: 'role' },
  { key: 'escalated', label: 'Escalated', to: '/support/escalations', icon: Flag, tone: 'danger' },
  { key: 'unassigned', label: 'Unassigned', to: '/support/tickets?assigned=UNASSIGNED', icon: UserX, tone: 'warning' },
  { key: 'assignedToMe', label: 'Assigned to me', to: '/support/tickets?assigned=ME', icon: UserCheck, tone: 'success' },
];

/** Colour of a tile: the icon tile, the bottom bar that grows on hover, and the glow behind the number. */
const TILE_TONES: Record<TileTone, { icon: string; bar: string; glow: string }> = {
  role: { icon: 'from-role-500 to-role-700', bar: 'bg-role-500', glow: 'bg-role-100/60' },
  warning: { icon: 'from-warning-500 to-accent-500', bar: 'bg-warning-500', glow: 'bg-warning-100/60' },
  danger: { icon: 'from-danger-500 to-danger-600', bar: 'bg-danger-500', glow: 'bg-danger-100/60' },
  info: { icon: 'from-brand-500 to-info-500', bar: 'bg-info-500', glow: 'bg-info-100/60' },
  success: { icon: 'from-success-500 to-success-600', bar: 'bg-success-500', glow: 'bg-success-100/60' },
};

/**
 * /support — where an agent starts: what waits right now (ticket counts and bookings that need attention, each a link
 * to its list), then the support metrics of a range (api-analytics §5): tickets opened and resolved against the
 * previous period, first-response and resolution times, open tickets by status and age, opened by category. The
 * three requests load separately, so one failing does not hide the others. Live updates refresh them.
 */
export function SupportDashboardPage() {
  const summary = useQuery({ queryKey: queryKeys.support.summary, queryFn: agentTicketApi.summary });
  const attention = useQuery({
    queryKey: queryKeys.support.bookingSearch({ ...ATTENTION, size: 1 }),
    queryFn: () => supportApi.searchBookings(ATTENTION, 1),
  });
  const [query, setQuery] = useAnalyticsQuery();
  const metrics = useQuery({
    queryKey: queryKeys.support.metricsRange(analyticsApiParams(query)),
    queryFn: () => supportMetricsApi.get(query),
    placeholderData: keepPreviousData,
  });
  const data = metrics.data;
  const problem = metrics.isError ? ApiError.from(metrics.error) : null;
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-6">
      <SupportHero
        icon={Headset}
        title="Support dashboard"
        description={<>{user?.firstName ? `Welcome back, ${user.firstName}. ` : ''}What is waiting for the support team right now, and how the desk is doing.</>}
        actions={<span className="hidden rounded-full bg-white/15 px-2 py-1 ring-1 ring-inset ring-white/25 sm:inline-flex"><LiveIndicator /></span>}
        chips={[
          { label: 'Open tickets', value: summary.data?.open, icon: Inbox, urgent: true },
          { label: 'Escalated', value: summary.data?.escalated, icon: Flag, urgent: true },
          { label: 'Need attention', value: attention.data?.totalElements, icon: AlertTriangle, urgent: true },
          { label: 'Assigned to me', value: summary.data?.assignedToMe, icon: UserCheck },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Section
          id="ticket-counts"
          title="Tickets"
          description="Right now"
          className="min-w-0 gap-3"
          actions={<Link to="/support/tickets" className={linkClass}>Open the ticket queue<ArrowRight className="size-4" aria-hidden="true" /></Link>}
        >
          {summary.isError ? (
            <TileError error={ApiError.from(summary.error)} what="the ticket counts" onRetry={() => void summary.refetch()} />
          ) : (
            <ul className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3">
              {TICKET_TILES.map((tile) => (
                <li key={tile.key}>
                  <CountTile label={tile.label} to={tile.to} icon={tile.icon} tone={tile.tone} value={summary.data?.[tile.key]} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          id="booking-counts"
          title="Bookings"
          description="Right now"
          className="min-w-0 gap-3"
          actions={<Link to="/support/bookings" className={linkClass}>Find a booking<ArrowRight className="size-4" aria-hidden="true" /></Link>}
        >
          {attention.isError ? (
            <TileError error={ApiError.from(attention.error)} what="the bookings that need attention" onRetry={() => void attention.refetch()} />
          ) : (
            <ul className="stagger grid gap-3">
              <li>
                <CountTile label="Need attention" to="/support/attention" icon={AlertTriangle} value={attention.data?.totalElements}
                  note="Refunds, cancellations and escalations" tone="danger" />
              </li>
            </ul>
          )}
        </Section>
      </div>

      <AnalyticsFilters
        key={JSON.stringify(query)}
        value={query}
        onChange={setQuery}
        served={data ? { range: data.range, interval: data.interval, previousRange: data.previousRange } : null}
        busy={metrics.isFetching && metrics.isPlaceholderData}
      />

      {problem?.code === 'INVALID_INTERVAL' ? (
        <Alert tone="warning" title="This interval does not fit the range">
          <p>{problem.message}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setQuery({ ...query, interval: null })}>
            Choose the interval automatically
          </Button>
        </Alert>
      ) : problem && (
        <ErrorState title="Could not load the support metrics" description={problem.message} correlationId={problem.correlationId}
          onRetry={() => void metrics.refetch()} compact />
      )}

      {(metrics.isPending || data) && <Metrics data={data} />}
    </div>
  );
}

const linkClass = 'inline-flex items-center gap-1 text-sm font-semibold text-role-700 hover:underline';

function Metrics({ data }: { data?: SupportMetrics }) {
  const loading = !data;
  const c = data?.comparison;
  const interval = data?.interval ?? 'DAY';
  const per = INTERVAL_LABELS[interval].per;
  const statusRows = TICKET_STATUSES.map((status) => ({ status: agentStatusLabel(status), tickets: data?.byStatus[status] ?? 0 }));
  const categoryRows = TICKET_CATEGORIES.map((category) => ({ category: agentCategoryLabel(category), tickets: data?.openedByCategory[category] ?? 0 }));
  const ageRows = (data?.age.buckets ?? []).map((bucket) => ({ age: bucket.label, tickets: bucket.count }));

  return (
    <div className="flex flex-col gap-8" aria-busy={loading || undefined}>
      <Section id="ticket-flow" title="Ticket flow" description="Tickets opened and resolved in the range, against the previous period">
        <KpiGrid label="Ticket flow" columns={3}>
          <KpiItem>
            <StatCard label="Tickets opened" value={data?.opened ?? 0} format={formatCount} loading={loading} icon={<LifeBuoy className="size-5" />}
              change={toStatChange(c?.opened, { upIsGood: false })} footer="Created in the range" />
          </KpiItem>
          <KpiItem>
            <StatCard label="Tickets resolved" value={data?.resolved ?? 0} format={formatCount} loading={loading} icon={<CheckCircle2 className="size-5" />}
              change={toStatChange(c?.resolved)} footer="Resolved or closed, not reopened" />
          </KpiItem>
          <KpiItem>
            <StatCard label="Open tickets now" value={data?.open ?? 0} format={formatCount} loading={loading} icon={<Inbox className="size-5" />}
              footer={data && (data.age.averageHours === null ? 'No open tickets' : <>Open for {formatHours(data.age.averageHours)} on average</>)} />
          </KpiItem>
        </KpiGrid>
      </Section>

      <Section id="response-times" title="Response times" description="Wall-clock time, of the tickets of the range">
        <KpiGrid label="Response times" columns={3}>
          <KpiItem>
            <StatCard label="First response, average" loading={loading} icon={<MessageCircleReply className="size-5" />}
              value={data ? formatMinutes(data.firstResponse.averageMinutes) : ''}
              change={toStatChange(c?.averageFirstResponseMinutes, { upIsGood: false })}
              footer={data && <>{formatCount(data.firstResponse.responded)} answered · {formatCount(data.firstResponse.awaiting)} still waiting</>} />
          </KpiItem>
          <KpiItem>
            <StatCard label="First response, median" loading={loading} icon={<Timer className="size-5" />}
              value={data ? formatMinutes(data.firstResponse.medianMinutes) : ''} footer="Half of the tickets were answered faster" />
          </KpiItem>
          <KpiItem>
            <StatCard label="Resolution time, average" loading={loading} icon={<Clock3 className="size-5" />}
              value={data ? formatHours(data.resolution.averageHours) : ''}
              footer={data && <>From opening to resolving · {formatCount(data.resolution.resolved)} resolved</>} />
          </KpiItem>
        </KpiGrid>
      </Section>

      <Reveal className="grid gap-4 lg:grid-cols-2">
        <ChartCard as="h2" title={`Tickets opened and resolved ${per}`} description="Each point is one day, week, month or year" className="lg:col-span-2">
          <BarChart
            title={`Tickets opened and resolved ${per}`}
            data={data?.series ?? []}
            xKey="start"
            xFormat={categoryFormat(interval, data?.range)}
            xLabel={categoryLabel(interval)}
            valueFormat="count"
            loading={loading}
            series={[{ key: 'opened', label: 'Opened' }, { key: 'resolved', label: 'Resolved', color: seriesColor(2) }]}
            emptyMessage="No tickets opened or resolved in this period"
          />
        </ChartCard>
        <ChartCard as="h2" title="All tickets by status" description="Every ticket as it is now">
          <BarChart title="All tickets by status" data={statusRows} xKey="status" xLabel="Status" valueFormat="count" loading={loading}
            series={[{ key: 'tickets', label: 'Tickets' }]} emptyMessage="No tickets yet" />
        </ChartCard>
        <ChartCard as="h2" title="Open tickets by age" description={data?.age.oldestOpenedAt ? 'Time since each open ticket was opened' : 'No open tickets'}>
          <BarChart title="Open tickets by age" data={ageRows} xKey="age" xLabel="Open for" valueFormat="count" loading={loading}
            series={[{ key: 'tickets', label: 'Open tickets', color: seriesColor(3) }]} emptyMessage="No open tickets" />
        </ChartCard>
        <ChartCard as="h2" title="Tickets opened by category" description="What the range’s tickets were about" className="lg:col-span-2">
          <BarChart title="Tickets opened by category" data={categoryRows} xKey="category" xLabel="Category" valueFormat="count" loading={loading}
            series={[{ key: 'tickets', label: 'Tickets opened', color: seriesColor(6) }]} emptyMessage="No tickets opened in this period" />
        </ChartCard>
      </Reveal>
    </div>
  );
}

/**
 * One figure: a label and a number, the whole tile clickable (a stretched link) to the list behind it. Skeleton while
 * loading. The link holds the label and the number and is named "Open: 3" (set explicitly: browsers pad text in a flex
 * layout differently), so its name always contains its visible words (WCAG 2.5.3); the note lies outside the link and
 * is its description.
 */
function CountTile({ label, value, to, note, icon: Icon, tone = 'role' }: {
  label: string;
  value: number | undefined;
  to: string;
  note?: ReactNode;
  icon: LucideIcon;
  tone?: TileTone;
}) {
  const noteId = useId();
  const colours = TILE_TONES[tone];
  return (
    <div className="group relative isolate flex h-full flex-col gap-2 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card hover-lift hover:border-role-200 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-role-600">
      <span aria-hidden="true" className={cn('pointer-events-none absolute -right-6 -top-8 -z-10 size-28 rounded-full blur-2xl transition-transform duration-500 group-hover:scale-125 motion-reduce:transition-none', colours.glow)} />
      <span aria-hidden="true" className={cn('absolute right-4 top-4 flex size-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md ring-1 ring-inset ring-white/20 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110 motion-reduce:transform-none', colours.icon)}>
        <Icon className="size-4" />
      </span>
      <Link
        to={to}
        aria-label={`${label}: ${value === undefined ? 'loading' : value.toLocaleString('en-IN')}`}
        aria-describedby={note ? noteId : undefined}
        className="flex flex-col gap-2 pr-11 outline-none after:absolute after:inset-0 after:rounded-2xl"
      >
        <span className="text-sm font-semibold text-slate-600">{label}</span>{' '}
        {value === undefined
          ? <Skeleton className="h-8 w-12" />
          : <span className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums"><AnimatedNumber value={value} /></span>}
      </Link>
      {note && <p id={noteId} className="text-xs text-slate-500">{note}</p>}
      <span aria-hidden="true" className={cn('absolute inset-x-0 bottom-0 h-1 origin-left scale-x-25 transition-transform duration-500 group-hover:scale-x-100 motion-reduce:transition-none', colours.bar)} />
    </div>
  );
}

function TileError({ error, what, onRetry }: { error: ApiError; what: string; onRetry: () => void }) {
  return (
    <Alert tone="danger" title={`Could not load ${what}`}>
      {error.message}
      {error.correlationId && <span className="block text-xs">Support reference: {error.correlationId}</span>}
      <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry}>Try again</Button>
    </Alert>
  );
}
