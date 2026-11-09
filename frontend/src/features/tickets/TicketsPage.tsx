import { useState, type FormEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { CircleCheck, ChevronRight, Clock, Hourglass, Inbox, LifeBuoy, ListChecks, MessageSquare, Plus, Search, X } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { KpiGrid, KpiItem } from '@/components/analytics';
import { ExportMenu } from '@/components/export/ExportMenu';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES_UP_TO_50, readPageSize } from '@/components/ui/paginationItems';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { SectionHeader } from '@/features/account/AccountLayout';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDateTime } from '@/lib/format';
import { ticketApi } from './ticketApi';
import {
  lastMessageByLabels, readTicketExtras, readTicketFilters, TICKET_CATEGORIES, TICKET_STATUSES, ticketCategoryLabels, ticketStatusInfo,
} from './ticketText';
import type { TicketSummary } from './types';

/** Tickets per page unless `?size=` asks for another; the API allows at most 50. */
const DEFAULT_PAGE_SIZE = 10;

/** "you" → "You": the "Last message from" column. */
const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** The columns of an export of my tickets: what each ticket card shows. */
const TICKET_COLUMNS: ExportColumn<TicketSummary>[] = [
  { header: 'Ticket number', value: (ticket) => ticket.ticketNumber },
  { header: 'Subject', value: (ticket) => ticket.subject },
  { header: 'Topic', value: (ticket) => ticketCategoryLabels[ticket.category] ?? ticket.category },
  { header: 'Booking reference', value: (ticket) => ticket.bookingReference },
  { header: 'Status', value: (ticket) => ticketStatusInfo[ticket.status]?.label ?? ticket.status },
  { header: 'Last message from', value: (ticket) => capitalized(lastMessageByLabels[ticket.lastMessageBy] ?? 'support') },
  { header: 'Last message', value: (ticket) => ticket.lastMessageAt, type: 'datetime' },
  { header: 'Opened', value: (ticket) => ticket.createdAt, type: 'datetime' },
];

/** /account/support — my support tickets, latest activity first. Live updates (`support.ticket-changed`) refresh it. */
export function TicketsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const base = readTicketFilters(params);
  const extras = readTicketExtras(params);
  // Search words and a topic go to the API only when set, so a plain list asks for exactly what it always did.
  const filters = extras.q || extras.category ? { ...base, ...extras } : base;
  const filtered = Boolean(filters.status || extras.q || extras.category);
  const size = readPageSize(params, PAGE_SIZES_UP_TO_50, DEFAULT_PAGE_SIZE);
  const tickets = useQuery({
    queryKey: queryKeys.support.ticketList({ ...filters, size }),
    queryFn: () => ticketApi.list(filters, size),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({ queryKey: queryKeys.support.mySummary, queryFn: ticketApi.summary });

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  const data = tickets.data;
  const shown = data && data.content.length > 0 ? data : null;
  return (
    <div>
      <SectionHeader
        title="Support tickets"
        description="Questions about a booking, a payment or a refund? Ask our support team; the answers appear here."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <LiveIndicator />
            {shown && (
              // My own tickets only: the same call as the list (the server scopes it to me), same status, topic and search.
              <ExportMenu
                title="Support tickets"
                subtitle={user ? `${user.firstName} ${user.lastName}` : undefined}
                fileName="support-tickets"
                columns={TICKET_COLUMNS}
                rows={shown.content}
                total={shown.totalElements}
                pageLabel={`Page ${shown.page + 1} of ${Math.max(shown.totalPages, 1)}`}
                fetchPage={(pageNo, pageSize) => ticketApi.list({ ...filters, page: pageNo }, pageSize)}
                rowKey={(ticket) => ticket.id}
                filters={describeFilters([
                  ['Status', filters.status && ticketStatusInfo[filters.status].label],
                  ['Topic', extras.category && ticketCategoryLabels[extras.category]],
                  ['Search', extras.q],
                ])}
              />
            )}
            <ButtonLink to="/account/support/new">
              <Plus className="size-4" aria-hidden="true" />
              New ticket
            </ButtonLink>
          </div>
        }
      />
      {summary.data && <Figures summary={summary.data} />}
      {summary.data && summary.data.waitingForYou > 0 && (
        <p className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <Hourglass className="size-4" aria-hidden="true" />
          {summary.data.waitingForYou === 1 ? '1 ticket is' : `${summary.data.waitingForYou} tickets are`} waiting for your reply.
          <button type="button" onClick={() => update({ status: 'WAITING_CUSTOMER' })} className="font-semibold underline underline-offset-2 hover:no-underline">Show them</button>
        </p>
      )}
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card sm:p-4">
        <TicketSearch key={extras.q} q={extras.q} onSearch={(q) => update({ q: q || null })} />
        <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 sm:w-60">
          <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">All tickets</option>
            {TICKET_STATUSES.map((status) => <option key={status} value={status}>{ticketStatusInfo[status].label}</option>)}
          </SelectField>
        </div>
        <div className="w-full min-w-0 sm:w-60">
          <SelectField label="Topic" value={extras.category} onChange={(event) => update({ category: event.target.value })}>
            <option value="">All topics</option>
            {TICKET_CATEGORIES.map((category) => <option key={category} value={category}>{ticketCategoryLabels[category]}</option>)}
          </SelectField>
        </div>
        <p className="flex items-center gap-2 text-sm text-slate-600 sm:ml-auto sm:max-w-xs">
          <LifeBuoy className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
          <span>
            Quick answers first? See{' '}
            <Link to="/help" className="font-semibold text-brand-700 hover:underline">Help &amp; Support</Link>.
          </span>
        </p>
        </div>
      </div>

      {tickets.isPending && <LoadingState label="Loading your support tickets…" rows={3} />}
      {tickets.isError && (
        <ErrorState description={ApiError.from(tickets.error).message} correlationId={ApiError.from(tickets.error).correlationId}
          onRetry={() => void tickets.refetch()} />
      )}
      {data && data.content.length === 0 && (
        <EmptyState
          illustration={filtered ? 'search' : 'inbox'}
          title={filtered ? 'No tickets match' : 'No support tickets yet'}
          description={filtered ? 'Try other words, or choose another status or topic.' : 'If something is not right with a booking, a payment or a refund, tell us here.'}
          action={filtered
            ? <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>Clear the filters</Button>
            : <ButtonLink to="/account/support/new" variant="secondary">Create a support ticket</ButtonLink>}
        />
      )}
      {data && data.content.length > 0 && (
        <>
          <ul className="flex flex-col gap-3 stagger" aria-label="Support tickets">
            {data.content.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)}
          </ul>
          <Pagination
            data={data}
            onPageChange={(page) => update({ page: String(page) })}
            onPageSizeChange={(next) => update({ size: next === DEFAULT_PAGE_SIZE ? null : String(next) })}
            pageSizes={PAGE_SIZES_UP_TO_50}
            noun={['ticket', 'tickets']}
            sizeLabel="Per page"
            className="mt-4"
          />
        </>
      )}
    </div>
  );
}

function TicketRow({ ticket }: { ticket: TicketSummary }) {
  const info = ticketStatusInfo[ticket.status];
  const waitingForMe = ticket.status === 'WAITING_CUSTOMER';
  return (
    <li>
      <Card interactive className={cn('group relative flex items-start gap-4 p-4 sm:p-5', waitingForMe && 'border-warning-200')}>
        <span
          aria-hidden="true"
          className={cn(
            'hidden size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset sm:flex',
            waitingForMe ? 'bg-warning-50 text-warning-700 ring-warning-200' : 'bg-brand-50 text-brand-700 ring-brand-100',
          )}
        >
          <MessageSquare className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            {/* The link covers the whole card (after:inset-0); the badge stays readable on top. */}
            <Link
              to={`/account/support/${ticket.id}`}
              className="break-words font-bold text-slate-900 after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:text-brand-700 group-hover:text-brand-700"
            >
              {ticket.subject}
            </Link>
            <Badge tone={info.tone} dot>{info.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {ticket.ticketNumber} · {ticketCategoryLabels[ticket.category] ?? ticket.category}
            {ticket.bookingReference ? ` · booking ${ticket.bookingReference}` : ''}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Last message from {lastMessageByLabels[ticket.lastMessageBy] ?? 'support'} · {formatDateTime(ticket.lastMessageAt)} · opened {formatDateTime(ticket.createdAt)}</span>
          </p>
        </div>
        <ChevronRight className="hidden size-5 shrink-0 self-center text-slate-400 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5 sm:block" aria-hidden="true" />
      </Card>
    </li>
  );
}

/** My tickets by status, from the server's own counts. */
function Figures({ summary }: { summary: import('./types').MyTicketSummary }) {
  const count = (value: number) => value.toLocaleString('en-IN');
  return (
    <KpiGrid label="Ticket figures" columns={4} className="mb-5">
      <KpiItem><StatCard label="Total tickets" value={summary.total} format={count} icon={<ListChecks className="size-5" />} /></KpiItem>
      <KpiItem><StatCard label="Open" value={summary.open} format={count} icon={<Inbox className="size-5" />} footer="Waiting for an agent" /></KpiItem>
      <KpiItem><StatCard label="In progress" value={summary.inProgress} format={count} icon={<Clock className="size-5" />} footer="Support is on it" /></KpiItem>
      <KpiItem><StatCard label="Resolved" value={summary.resolved + summary.closed} format={count} icon={<CircleCheck className="size-5" />} footer="Solved or closed" /></KpiItem>
    </KpiGrid>
  );
}

function TicketSearch({ q, onSearch }: { q: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(q);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(text.trim());
  };
  return (
    <form role="search" aria-label="Search my tickets" onSubmit={submit} className="relative">
      <label htmlFor="ticket-search" className="sr-only">Search my tickets</label>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        id="ticket-search"
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Ticket number or words of the subject"
        autoComplete="off"
        className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-24 text-sm text-slate-900 placeholder:text-slate-500 transition-[border-color,box-shadow] duration-(--duration-fast) hover:border-slate-300 focus:border-role-400 focus:ring-4 focus:ring-role-500/15 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button type="button" aria-label="Clear search" onClick={() => { setText(''); onSearch(''); }}
          className="absolute right-[4.75rem] top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
      <Button type="submit" size="sm" className="absolute right-1.5 top-1/2 -translate-y-1/2">Search</Button>
    </form>
  );
}
