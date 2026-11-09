import { useId, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ChevronRight, Clock3, Flag, Inbox, Loader, Search, UserCheck, UserX } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { ExportMenu } from '@/components/export/ExportMenu';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { TICKET_CATEGORIES, TICKET_STATUSES } from '@/features/tickets/ticketText';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDateTime } from '@/lib/format';
import { Initials } from '@/features/admin/dashboard/dashKit';
import { FilterCard, ListLoading } from '@/features/admin/shared/adminUi';
import { TableCard } from '@/components/ui/DataTable';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { agentTicketApi } from './agentTicketApi';
import { PillTabs, ResultCount, SupportHero } from './SupportKit';
import { AgentStatusBadge, AssignToMeButton, PriorityBadge } from './TicketParts';
import {
  agentCategoryLabel,
  agentCategoryLabels,
  agentStatusLabel,
  assignedLabels,
  assigneeLabel,
  DEFAULT_QUEUE_SORT,
  isAssignedToMe,
  priorityLabels,
  QUEUE_SORTS,
  readQueueFilters,
  TICKET_PRIORITIES,
} from './ticketQueueText';
import type { AgentTicketSummary, AssignedFilter } from './types';

const ASSIGNED: readonly AssignedFilter[] = ['ANY', 'ME', 'UNASSIGNED'];
const LAST_BY: Record<AgentTicketSummary['lastMessageBy'], string> = { CUSTOMER: 'Customer', SUPPORT: 'Support', SYSTEM: 'System' };

/**
 * The columns of an export (CSV, Excel, PDF): the queue's columns, one figure per column. "Assigned to" names the agent
 * who exported for their own tickets ("You" would mean nothing in a shared file). Messages and notes are not exported.
 */
function exportColumns(me: { id?: string; name?: string }): ExportColumn<AgentTicketSummary>[] {
  return [
    { header: 'Ticket', value: (ticket) => ticket.ticketNumber },
    { header: 'Subject', value: (ticket) => ticket.subject, width: 40 },
    { header: 'Topic', value: (ticket) => agentCategoryLabel(ticket.category) },
    { header: 'Booking reference', value: (ticket) => ticket.bookingReference },
    { header: 'Customer e-mail', value: (ticket) => ticket.customerEmail },
    { header: 'Status', value: (ticket) => agentStatusLabel(ticket.status) },
    { header: 'Priority', value: (ticket) => priorityLabels[ticket.priority] ?? ticket.priority },
    {
      header: 'Assigned to',
      value: (ticket) => (isAssignedToMe(ticket, me.id) ? (me.name ?? 'Me') : ticket.assignedAgentId ? 'Another agent' : 'Unassigned'),
    },
    { header: 'Opened', value: (ticket) => ticket.createdAt, type: 'datetime' },
    { header: 'Last activity', value: (ticket) => ticket.lastMessageAt, type: 'datetime' },
    { header: 'Last message by', value: (ticket) => LAST_BY[ticket.lastMessageBy] ?? ticket.lastMessageBy },
  ];
}
/** Rows per page unless `?size=` asks for another of `PAGE_SIZES` (the API allows up to 100). */
const DEFAULT_PAGE_SIZE = 25;

/**
 * /support/tickets — every customer ticket: a hero with the desk's counts, quick filters (status and assignment) as pills
 * with counts, the detailed filters, and a paged table. Filters, search, sorting and paging are kept in the URL.
 */
export function TicketQueuePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const filters = readQueueFilters(params);
  const size = readPageSize(params, PAGE_SIZES, DEFAULT_PAGE_SIZE);
  const queue = useQuery({
    queryKey: queryKeys.support.queueList({ ...filters, size }),
    queryFn: () => agentTicketApi.queue(filters, size),
    placeholderData: keepPreviousData,
  });
  // The counts on the pills: the same cached figures as the dashboard. A failure just hides the numbers.
  const summary = useQuery({ queryKey: queryKeys.support.summary, queryFn: agentTicketApi.summary });
  const counts = summary.data;

  /** Any change but paging starts at page 1; defaults are left out of the URL. */
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  const filtered = filters.q !== '' || filters.status !== '' || filters.category !== '' || filters.priority !== '' || filters.assigned !== 'ANY';

  const data = queue.data;
  const error = queue.isError ? ApiError.from(queue.error) : null;
  return (
    <div className="flex flex-col gap-5">
      <SupportHero
        icon={Inbox}
        title="Ticket queue"
        description="Customer questions about bookings, payments and refunds. Assign a ticket to yourself before you answer it."
        actions={<span className="hidden rounded-full bg-white/15 px-2 py-1 ring-1 ring-inset ring-white/25 sm:inline-flex"><LiveIndicator /></span>}
        chips={[
          { label: 'Open', value: counts?.open, icon: Inbox, urgent: true },
          { label: 'Escalated', value: counts?.escalated, icon: Flag, urgent: true },
          { label: 'Unassigned', value: counts?.unassigned, icon: UserX },
          { label: 'Assigned to me', value: counts?.assignedToMe, icon: UserCheck },
        ]}
      />

      <div className="flex flex-col gap-2.5">
        <PillTabs
          label="Quick status filter"
          active={filters.status || 'ALL'}
          onSelect={(key) => update({ status: key === 'ALL' ? null : key })}
          tabs={[
            { key: 'ALL', label: 'All tickets', icon: Inbox },
            { key: 'OPEN', label: 'Open', icon: Inbox, count: counts?.open },
            { key: 'IN_PROGRESS', label: 'In progress', icon: Loader, count: counts?.inProgress },
            { key: 'WAITING_CUSTOMER', label: 'Waiting for customer', icon: Clock3, count: counts?.waitingCustomer },
            { key: 'ESCALATED', label: 'Escalated', icon: Flag, count: counts?.escalated },
          ]}
        />
        <PillTabs
          label="Quick assignment filter"
          active={filters.assigned}
          onSelect={(key) => update({ assigned: key === 'ANY' ? null : key })}
          tabs={[
            { key: 'ANY', label: 'Anyone' },
            { key: 'UNASSIGNED', label: 'Unassigned', icon: UserX, count: counts?.unassigned },
            { key: 'ME', label: 'Assigned to me', icon: UserCheck, count: counts?.assignedToMe },
          ]}
        />
      </div>

      <FilterCard>
        <SearchForm key={filters.q} initial={filters.q} onSearch={(q) => update({ q })} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">All statuses</option>
            {TICKET_STATUSES.map((status) => <option key={status} value={status}>{agentStatusLabel(status)}</option>)}
          </SelectField>
          <SelectField label="Topic" value={filters.category} onChange={(event) => update({ category: event.target.value })}>
            <option value="">All topics</option>
            {TICKET_CATEGORIES.map((category) => <option key={category} value={category}>{agentCategoryLabels[category]}</option>)}
          </SelectField>
          <SelectField label="Priority" value={filters.priority} onChange={(event) => update({ priority: event.target.value })}>
            <option value="">All priorities</option>
            {TICKET_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
          </SelectField>
          <SelectField label="Assigned" value={filters.assigned}
            onChange={(event) => update({ assigned: event.target.value === 'ANY' ? null : event.target.value })}>
            {ASSIGNED.map((value) => <option key={value} value={value}>{assignedLabels[value]}</option>)}
          </SelectField>
          <SelectField label="Sort by" value={filters.sort}
            onChange={(event) => update({ sort: event.target.value === DEFAULT_QUEUE_SORT ? null : event.target.value })}>
            {QUEUE_SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </SelectField>
        </div>
      </FilterCard>

      {queue.isPending && <ListLoading label="Loading tickets…" />}
      {error && (
        <ErrorState title={error.status === 403 ? 'No access to support tickets' : undefined} description={error.message}
          correlationId={error.correlationId} onRetry={error.status === 403 ? undefined : () => void queue.refetch()} />
      )}
      {data && data.content.length === 0 && (
        <EmptyState
          illustration={filtered ? 'search' : 'inbox'}
          title={filtered ? 'No tickets match these filters' : 'No tickets yet'}
          description={filtered ? 'Change the filters or clear the search.' : 'New customer tickets appear here.'}
        />
      )}
      {data && data.content.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ResultCount total={data.totalElements} noun={['ticket', 'tickets']} />
            <ExportMenu
              className="ml-auto"
              title="Support tickets"
              fileName="support-tickets"
              columns={exportColumns({ id: user?.id, name: user ? `${user.firstName} ${user.lastName}` : undefined })}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={(page, pageSize) => agentTicketApi.queue({ ...filters, page }, pageSize)}
              rowKey={(ticket) => ticket.id}
              filters={describeFilters([
                ['Search', filters.q],
                ['Status', filters.status && agentStatusLabel(filters.status)],
                ['Topic', filters.category && agentCategoryLabels[filters.category]],
                ['Priority', filters.priority && priorityLabels[filters.priority]],
                ['Assigned', filters.assigned !== 'ANY' && assignedLabels[filters.assigned]],
                ['Sort', QUEUE_SORTS.find((option) => option.value === filters.sort)?.label],
              ])}
              personalData
            />
          </div>
          <QueueTable rows={data.content} />
          <Pagination
            data={data}
            jump
            onPageChange={(page) => update({ page: String(page) })}
            onPageSizeChange={(next) => update({ size: next === DEFAULT_PAGE_SIZE ? null : String(next) })}
            noun={['ticket', 'tickets']}
          />
        </>
      )}
    </div>
  );
}

function SearchForm({ initial, onSearch }: { initial: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(initial);
  const hintId = useId();
  return (
    <form role="search" className="flex flex-col gap-1" onSubmit={(event) => { event.preventDefault(); onSearch(text.trim()); }}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <TextField label="Search" type="search" value={text} onChange={(event) => setText(event.target.value)}
            placeholder="TK-7K3M9Q2X or asha@example.com" aria-describedby={hintId} />
        </div>
        <Button type="submit" variant="role"><Search className="size-4" aria-hidden="true" />Search</Button>
        {initial && <Button variant="ghost" onClick={() => { setText(''); onSearch(''); }}>Clear</Button>}
      </div>
      <p id={hintId} className="text-xs text-slate-500">Ticket number, customer e-mail or subject.</p>
    </form>
  );
}

/** The coloured edge of a row: what needs a look first (high priority or escalated) stands out. */
function edgeOf(ticket: AgentTicketSummary): string {
  if (ticket.status === 'ESCALATED' || ticket.priority === 'HIGH') return 'before:bg-danger-500';
  if (ticket.status === 'OPEN') return 'before:bg-warning-500';
  if (ticket.status === 'IN_PROGRESS') return 'before:bg-info-500';
  if (ticket.status === 'WAITING_CUSTOMER') return 'before:bg-role-400';
  return 'before:bg-slate-200';
}

/** The queue as a table (rows of every page; a phone scrolls it sideways). A row opens its ticket. */
export function QueueTable({ rows, caption = 'Tickets' }: { rows: AgentTicketSummary[]; caption?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <TableCard caption={caption}>
      <thead>
        <tr>
          <th scope="col" className={tableStyles.th}>Ticket</th>
          <th scope="col" className={tableStyles.th}>Customer</th>
          <th scope="col" className={tableStyles.th}>Status</th>
          <th scope="col" className={tableStyles.th}>Assigned</th>
          <th scope="col" className={tableStyles.th}>Last activity</th>
          <th scope="col" className={tableStyles.th}><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody className={tableStyles.tbody}>
        {rows.map((ticket) => {
          const mine = isAssignedToMe(ticket, user?.id) === true;
          const to = `/support/tickets/${encodeURIComponent(ticket.id)}`;
          return (
            <tr
              key={ticket.id}
              className={`${tableStyles.tr} group cursor-pointer align-top`}
              // The subject is the keyboard and screen reader way in; the whole row is a bigger target for the mouse.
              onClick={(event) => { if (!(event.target as HTMLElement).closest('a, button')) void navigate(to); }}
            >
              <td className={cn('relative min-w-60 px-4 py-3 before:absolute before:inset-y-2.5 before:left-0 before:w-1 before:rounded-r-full', edgeOf(ticket))}>
                <Link to={to} className="break-words font-semibold text-role-700 hover:underline">
                  {ticket.subject}
                </Link>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {ticket.ticketNumber} · {agentCategoryLabel(ticket.category)}
                  {ticket.bookingReference ? ` · ${ticket.bookingReference}` : ''}
                </span>
              </td>
              <td className="min-w-56 px-4 py-3">
                <span className="flex items-center gap-2.5">
                  <Initials email={ticket.customerEmail} className="size-8 text-xs" />
                  <span className="min-w-0 break-words text-slate-700 [overflow-wrap:anywhere]">{ticket.customerEmail ?? '—'}</span>
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="flex flex-wrap gap-1">
                  <AgentStatusBadge status={ticket.status} />
                  <PriorityBadge priority={ticket.priority} />
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
                  mine ? 'bg-role-50 text-role-700 ring-role-200' : ticket.assignedAgentId ? 'bg-slate-50 text-slate-700 ring-slate-200' : 'bg-warning-50 text-warning-700 ring-warning-200')}>
                  {mine || ticket.assignedAgentId ? <UserCheck className="size-3.5" aria-hidden="true" /> : <UserX className="size-3.5" aria-hidden="true" />}
                  {assigneeLabel(ticket, user?.id)}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                <span className="block">{formatDateTime(ticket.lastMessageAt)}</span>
                <span className="block text-xs text-slate-500">by {ticket.lastMessageBy === 'CUSTOMER' ? 'customer' : ticket.lastMessageBy === 'SUPPORT' ? 'support' : 'system'}</span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right">
                <span className="inline-flex items-center gap-2">
                  {!mine && ticket.status !== 'CLOSED' && <AssignToMeButton ticketId={ticket.id} ticketNumber={ticket.ticketNumber} />}
                  <ChevronRight aria-hidden="true" className="size-5 text-slate-300 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-role-600 motion-reduce:transform-none" />
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableCard>
  );
}
