import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle, Clock, Flame, Hourglass, Inbox, LifeBuoy, ListChecks, MessageSquareReply, Timer, UserCheck, UserX, CircleCheck, type LucideIcon } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { KpiGrid, KpiItem } from '@/components/analytics';
import { ExportMenu } from '@/components/export/ExportMenu';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { DateField } from '@/components/ui/DateField';
import { SelectField } from '@/components/ui/Field';
import { selectClass } from '@/components/ui/fieldStyles';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/StateViews';
import { agentTicketApi } from '@/features/support/agentTicketApi';
import { supportMetricsApi } from '@/features/support/supportMetricsApi';
import {
  agentCategoryLabel, agentCategoryLabels, agentStatusInfo, agentStatusLabel, assignedLabels, isAssignedToMe, priorityLabels,
  QUEUE_SORTS, readQueueExtras, readQueueFilters, TICKET_PRIORITIES,
} from '@/features/support/ticketQueueText';
import type { AgentTicketSummary, AssignedFilter, SupportSummary, TicketPriority } from '@/features/support/types';
import { TICKET_CATEGORIES, TICKET_STATUSES } from '@/features/tickets/ticketText';
import type { TicketStatus } from '@/features/tickets/types';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  FilterCard, ListLoading, LoadError, PageHeader, RequirePermission, ResultCount, SearchBox, SortHeader, TableShell, tdClass,
} from '../shared/adminUi';
import { useCan } from '../shared/permissions';
import { readSort, sortParam, useSearchState, type SortState } from '../shared/searchState';
import { userApi } from '../users/userApi';

const ticketLink = (ticketId: string) => `/support/tickets/${ticketId}`;
const SORT_FIELDS = ['createdAt', 'lastMessageAt'] as const;
const METRICS_RANGE = { preset: 'LAST_30_DAYS', from: '', to: '', interval: null } as const;

/**
 * The columns of an export (CSV, Excel, PDF): what the table shows. The assigned agent is named, because the
 * screen's "You" would not say who in a shared file.
 */
const exportColumns = (agentName: (ticket: AgentTicketSummary) => string): ExportColumn<AgentTicketSummary>[] => [
  { header: 'Ticket', value: (ticket) => ticket.ticketNumber },
  { header: 'Booking reference', value: (ticket) => ticket.bookingReference },
  { header: 'Customer', value: (ticket) => ticket.customerEmail },
  { header: 'Subject', value: (ticket) => ticket.subject },
  { header: 'Category', value: (ticket) => agentCategoryLabel(ticket.category) },
  { header: 'Priority', value: (ticket) => priorityLabels[ticket.priority] ?? ticket.priority },
  { header: 'Status', value: (ticket) => agentStatusLabel(ticket.status) },
  { header: 'Assigned agent', value: agentName },
  { header: 'Created', value: (ticket) => ticket.createdAt, type: 'datetime' },
  { header: 'Updated', value: (ticket) => ticket.lastMessageAt, type: 'datetime' },
];

/**
 * /admin/support — support management: figures (all tickets, open, in progress, resolved, high priority and the average
 * time to resolve), quick filters, and a queue an admin can search, filter by status, priority, category, agent and day
 * opened, sort, and work (assign, status, priority). A conversation opens in the support portal
 * (`/support/tickets/:id`), which admins may use too: reading, replying and the history are there.
 */
export function AdminSupportPage() {
  return (
    <RequirePermission permission="SUPPORT_TICKET_MANAGE">
      <SupportQueue />
    </RequirePermission>
  );
}

function SupportQueue() {
  const { params, update } = useSearchState();
  const { user } = useAuth();
  const filters = { ...readQueueFilters(params), ...readQueueExtras(params) };
  const canSeeUsers = useCan('USER_READ_ANY');
  const summary = useQuery({ queryKey: queryKeys.support.summary, queryFn: agentTicketApi.summary });
  const metrics = useQuery({
    queryKey: queryKeys.support.metricsRange({ ...METRICS_RANGE }),
    queryFn: () => supportMetricsApi.get(METRICS_RANGE),
  });
  // The agents (and admins, who may take tickets too), to name them in the list and the agent filter.
  const staff = useQueries({
    queries: (['SUPPORT_AGENT', 'ADMIN'] as const).map((role) => ({
      queryKey: queryKeys.admin.userList({ role, purpose: 'ticket-agents' }),
      queryFn: () => userApi.list({ search: '', role, status: 'ACTIVE', page: 0 }, 100),
      enabled: canSeeUsers,
      staleTime: 5 * 60_000,
    })),
  });
  const agents = new Map<string, string>();
  for (const result of staff) {
    for (const user of result.data?.content ?? []) {
      agents.set(user.id, `${user.firstName} ${user.lastName}`.trim() || user.email);
    }
  }
  const size = readPageSize(params, PAGE_SIZES, 25);
  const sort = readSort(params, SORT_FIELDS, null);
  const queueFilters = { ...filters, sort: sort ? sortParam(sort)! : filters.sort };
  const tickets = useQuery({
    queryKey: [...queryKeys.support.queueList({ ...queueFilters }), size],
    queryFn: () => agentTicketApi.queue(queueFilters, size),
    placeholderData: keepPreviousData,
  });
  const data = tickets.data;
  const onSort = (next: SortState) => update({ sort: sortParam(next) });
  const filtered = Boolean(filters.q || filters.status || filters.category || filters.priority || filters.agent
    || filters.from || filters.to || filters.assigned !== 'ANY');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={<LifeBuoy className="size-5" />}
        title="Support"
        description={<>The customers' tickets. Open a ticket to read and answer it in the <Link to="/support/tickets" className="font-medium text-role-700 hover:underline">support portal</Link>.</>}
        actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>}
      />
      <Figures summary={summary.data} loading={summary.isPending} averageHours={metrics.data?.resolution.averageHours ?? null}
        metricsLoading={metrics.isPending} />
      {summary.isError && <LoadError error={summary.error} onRetry={() => void summary.refetch()} title="The counts could not be loaded" />}
      {summary.data && (
        <QuickFilters summary={summary.data} filters={filters} onChange={(changes) => update(changes)} />
      )}

      <FilterCard>
        <SearchBox key={filters.q} initial={filters.q} label="Search" placeholder="TK-7K3M9Q2X, e-mail or subject"
          hint="Ticket number, customer e-mail, or words of the subject." onSearch={(q) => update({ q })} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">All statuses</option>
            {TICKET_STATUSES.map((status) => <option key={status} value={status}>{agentStatusLabel(status)}</option>)}
          </SelectField>
          <SelectField label="Category" value={filters.category} onChange={(event) => update({ category: event.target.value })}>
            <option value="">All categories</option>
            {TICKET_CATEGORIES.map((category) => <option key={category} value={category}>{agentCategoryLabels[category]}</option>)}
          </SelectField>
          <SelectField label="Priority" value={filters.priority} onChange={(event) => update({ priority: event.target.value })}>
            <option value="">All priorities</option>
            {TICKET_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
          </SelectField>
          <SelectField label="Assigned" value={filters.assigned} onChange={(event) => update({ assigned: event.target.value === 'ANY' ? null : event.target.value })}>
            {(Object.keys(assignedLabels) as AssignedFilter[]).map((value) => <option key={value} value={value}>{assignedLabels[value]}</option>)}
          </SelectField>
          {canSeeUsers && (
            <SelectField label="Agent" value={filters.agent ?? ''} onChange={(event) => update({ agent: event.target.value })}>
              <option value="">Any agent</option>
              {[...agents].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              {filters.agent && !agents.has(filters.agent) && <option value={filters.agent}>Another agent</option>}
            </SelectField>
          )}
          <DateField label="Opened from" value={filters.from ?? ''} max={filters.to || undefined} rangeEnd={filters.to}
            onChange={(from) => update({ from })} />
          <DateField label="Opened to" value={filters.to ?? ''} min={filters.from || undefined} rangeStart={filters.from}
            onChange={(to) => update({ to })} />
        </div>
      </FilterCard>

      {tickets.isPending && <ListLoading label="Loading tickets…" />}
      {tickets.isError && <LoadError error={tickets.error} onRetry={() => void tickets.refetch()} />}
      {data && data.content.length === 0 && (
        <EmptyState
          illustration="search"
          title="No tickets found"
          description={filtered ? 'Try other words, or clear some of the filters.' : 'Tickets appear here when customers write to support.'}
        />
      )}
      {data && data.content.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ResultCount count={data.totalElements} noun={['ticket', 'tickets']} />
            <ExportMenu
              className="ml-auto"
              title="Support tickets"
              subtitle="Admin portal"
              fileName="support-tickets"
              columns={exportColumns((ticket) => {
                if (isAssignedToMe(ticket, user?.id) === true) return user ? `${user.firstName} ${user.lastName}`.trim() : 'Me';
                return ticket.assignedAgentId ? (agents.get(ticket.assignedAgentId) ?? 'Another agent') : 'Unassigned';
              })}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={(page, pageSize) => agentTicketApi.queue({ ...queueFilters, page }, pageSize)}
              rowKey={(ticket) => ticket.id}
              filters={describeFilters([
                ['Search', filters.q],
                ['Status', filters.status && agentStatusLabel(filters.status)],
                ['Category', filters.category && agentCategoryLabel(filters.category)],
                ['Priority', filters.priority && priorityLabels[filters.priority]],
                ['Assigned', filters.assigned !== 'ANY' && assignedLabels[filters.assigned]],
                ['Agent', filters.agent && (agents.get(filters.agent) ?? 'Another agent')],
                ['Opened from', filters.from && formatDate(filters.from)],
                ['Opened to', filters.to && formatDate(filters.to)],
                ['Sort', QUEUE_SORTS.find((option) => option.value === queueFilters.sort)?.label ?? queueFilters.sort],
              ])}
              personalData
            />
          </div>
          <TableShell caption="Support tickets" scroll>
            <thead>
              <tr>
                <th scope="col" className={tableStyles.th}>Ticket</th>
                <th scope="col" className={tableStyles.th}>Customer</th>
                <th scope="col" className={tableStyles.th}>Subject</th>
                <th scope="col" className={tableStyles.th}>Category</th>
                <th scope="col" className={tableStyles.th}>Priority</th>
                <th scope="col" className={tableStyles.th}>Status</th>
                <th scope="col" className={tableStyles.th}>Assigned agent</th>
                <SortHeader label="Created" field="createdAt" sort={sort} onSort={onSort} />
                <SortHeader label="Updated" field="lastMessageAt" sort={sort} onSort={onSort} />
                <th scope="col" className={tableStyles.th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className={tableStyles.tbody}>
              {data.content.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} agents={agents} />)}
            </tbody>
          </TableShell>
          <Pagination data={data} noun={['ticket', 'tickets']} pageSizes={PAGE_SIZES}
            onPageChange={(page) => update({ page: String(page) })} onPageSizeChange={(next) => update({ size: next === 25 ? null : String(next) })} />
        </>
      )}
    </div>
  );
}

/** "3.2 h" / "45 min": the average time from opening to resolving, from the server. */
function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toLocaleString('en-IN', { maximumFractionDigits: 1 })} h`;
  return `${(hours / 24).toLocaleString('en-IN', { maximumFractionDigits: 1 })} days`;
}

/** The six figures at the top: every number comes from the support endpoints. */
function Figures({ summary, loading, averageHours, metricsLoading }: {
  summary?: SupportSummary;
  loading: boolean;
  averageHours: number | null;
  metricsLoading: boolean;
}) {
  const count = (value: number) => value.toLocaleString('en-IN');
  return (
    <KpiGrid label="Ticket figures" columns={3} className="xl:grid-cols-3 2xl:grid-cols-6">
      <KpiItem>
        <StatCard label="Total tickets" icon={<ListChecks className="size-5" />} loading={loading} value={summary?.total ?? 0}
          format={count} footer="Ever opened" />
      </KpiItem>
      <KpiItem>
        <StatCard label="Open tickets" icon={<Inbox className="size-5" />} loading={loading} value={summary?.open ?? 0}
          format={count} footer="Waiting for an agent" />
      </KpiItem>
      <KpiItem>
        <StatCard label="In progress" icon={<Clock className="size-5" />} loading={loading} value={summary?.inProgress ?? 0}
          format={count} footer="An agent is on it" />
      </KpiItem>
      <KpiItem>
        <StatCard label="Resolved" icon={<CircleCheck className="size-5" />} loading={loading} value={summary?.resolved ?? 0}
          format={count} footer="Solved, not closed yet" />
      </KpiItem>
      <KpiItem>
        <StatCard label="High priority" icon={<Flame className="size-5" />} loading={loading} value={summary?.highPriority ?? 0}
          format={count} footer="Not resolved yet" />
      </KpiItem>
      <KpiItem>
        <StatCard label="Average resolution time" icon={<Timer className="size-5" />} loading={metricsLoading}
          value={formatHours(averageHours)} footer="Tickets resolved in the last 30 days" />
      </KpiItem>
    </KpiGrid>
  );
}

type QueueChange = Record<string, string | null | undefined>;

/** Small counts that double as filters: a click shows exactly those tickets (a second click clears it). */
function QuickFilters({ summary, filters, onChange }: {
  summary: SupportSummary;
  filters: ReturnType<typeof readQueueFilters>;
  onChange: (changes: QueueChange) => void;
}) {
  const items: { label: string; value: number; icon: LucideIcon; active: boolean; apply: QueueChange; clear: QueueChange }[] = [
    { label: 'Waiting for customer', value: summary.waitingCustomer, icon: Hourglass, active: filters.status === 'WAITING_CUSTOMER',
      apply: { status: 'WAITING_CUSTOMER' }, clear: { status: null } },
    { label: 'Escalated', value: summary.escalated, icon: AlertTriangle, active: filters.status === 'ESCALATED',
      apply: { status: 'ESCALATED' }, clear: { status: null } },
    { label: 'Unassigned', value: summary.unassigned, icon: UserX, active: filters.assigned === 'UNASSIGNED',
      apply: { assigned: 'UNASSIGNED' }, clear: { assigned: null } },
    { label: 'Assigned to me', value: summary.assignedToMe, icon: UserCheck, active: filters.assigned === 'ME',
      apply: { assigned: 'ME' }, clear: { assigned: null } },
  ];
  return (
    <ul aria-label="Quick filters" className="flex flex-wrap gap-2">
      {items.map(({ label, value, icon: Icon, active, apply, clear }) => (
        <li key={label}>
          <button
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? clear : apply)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition-colors duration-(--duration-fast)',
              active ? 'bg-role-600 text-white ring-role-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-role-50 hover:text-role-700',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
            <span className={cn('rounded-full px-1.5 text-xs tabular-nums', active ? 'bg-white/20' : 'bg-slate-100 text-slate-700')}>
              {value.toLocaleString('en-IN')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const TONE_SELECT: Record<'neutral' | 'info' | 'success' | 'warning' | 'danger', string> = {
  neutral: '',
  info: 'border-info-200 bg-info-50 text-info-700',
  success: 'border-success-200 bg-success-50 text-success-700',
  warning: 'border-warning-200 bg-warning-50 text-warning-700',
  danger: 'border-danger-200 bg-danger-50 text-danger-700',
};

function TicketRow({ ticket, agents }: { ticket: AgentTicketSummary; agents: Map<string, string> }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.support.queue });
    void queryClient.invalidateQueries({ queryKey: queryKeys.support.summary });
    void queryClient.invalidateQueries({ queryKey: queryKeys.support.ticket(ticket.id) });
  };
  const fail = (error: unknown) => {
    const problem = ApiError.from(error);
    toast.error(problem.message, { description: problem.correlationId ? `Support reference: ${problem.correlationId}` : undefined });
  };
  const assign = useMutation({
    mutationFn: () => agentTicketApi.assign(ticket.id),
    onSuccess: () => { refresh(); toast.success(`${ticket.ticketNumber} is assigned to you.`); },
    onError: fail,
  });
  const change = useMutation({
    mutationFn: (next: { status: TicketStatus; priority?: TicketPriority }) => agentTicketApi.changeStatus(ticket.id, next),
    onSuccess: () => { refresh(); toast.success(`${ticket.ticketNumber} updated.`); },
    onError: fail,
  });
  const mine = isAssignedToMe(ticket, user?.id) === true;
  const status = agentStatusInfo[ticket.status] ?? { label: ticket.status, tone: 'neutral' as const };
  const closed = ticket.status === 'CLOSED';
  const high = ticket.priority === 'HIGH';
  const agentName = mine ? 'You' : ticket.assignedAgentId ? (agents.get(ticket.assignedAgentId) ?? 'Another agent') : null;

  return (
    <tr className={tableStyles.tr}>
      <td className={`${tdClass} whitespace-nowrap`}>
        <Link to={ticketLink(ticket.id)} className="font-mono text-xs font-semibold text-role-700 hover:underline">{ticket.ticketNumber}</Link>
        {ticket.bookingReference && <span className="block text-xs text-slate-500">{ticket.bookingReference}</span>}
      </td>
      <td className={`${tdClass} max-w-48 break-all text-slate-700`}>{ticket.customerEmail ?? '—'}</td>
      <td className={`${tdClass} max-w-64 font-medium text-slate-900`}>{ticket.subject}</td>
      <td className={`${tdClass} whitespace-nowrap`}><Badge>{agentCategoryLabel(ticket.category)}</Badge></td>
      <td className={tdClass}>
        <span className="inline-flex items-center gap-1.5">
          {high && <Flame className="size-4 shrink-0 text-danger-600" aria-hidden="true" />}
          <select
            aria-label={`Priority of ${ticket.ticketNumber}`}
            value={ticket.priority}
            disabled={change.isPending || closed}
            onChange={(event) => change.mutate({ status: ticket.status, priority: event.target.value as TicketPriority })}
            className={cn(selectClass(false, { inline: true, size: 'sm' }), high && TONE_SELECT.danger)}
          >
            {TICKET_PRIORITIES.map((value) => <option key={value} value={value}>{priorityLabels[value]}</option>)}
          </select>
        </span>
      </td>
      <td className={tdClass}>
        {closed ? <Badge tone={status.tone} dot>{status.label}</Badge> : (
          <select
            aria-label={`Status of ${ticket.ticketNumber}`}
            value={ticket.status}
            disabled={change.isPending}
            onChange={(event) => change.mutate({ status: event.target.value as TicketStatus })}
            className={cn(selectClass(false, { inline: true, size: 'sm' }), TONE_SELECT[status.tone])}
          >
            {TICKET_STATUSES.map((value) => <option key={value} value={value}>{agentStatusLabel(value)}</option>)}
          </select>
        )}
      </td>
      <td className={`${tdClass} whitespace-nowrap`}>
        <span className={cn('block', agentName ? 'text-slate-800' : 'text-slate-500')}>{agentName ?? 'Unassigned'}</span>
        {!mine && !closed && (
          <Button size="sm" variant="secondary" className="mt-1" loading={assign.isPending} onClick={() => assign.mutate()}
            aria-label={`Assign ${ticket.ticketNumber} to me`}>
            Assign to me
          </Button>
        )}
      </td>
      <td className={`${tdClass} whitespace-nowrap text-slate-700`}>{formatDateTime(ticket.createdAt)}</td>
      <td className={`${tdClass} whitespace-nowrap text-slate-700`}>{formatDateTime(ticket.lastMessageAt)}</td>
      <td className={`${tdClass} whitespace-nowrap text-right`}>
        <Link
          to={ticketLink(ticket.id)}
          aria-label={`Open ticket ${ticket.ticketNumber}`}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-role-700 hover:bg-role-50"
        >
          <MessageSquareReply className="size-4" aria-hidden="true" />
          Open
        </Link>
      </td>
    </tr>
  );
}
