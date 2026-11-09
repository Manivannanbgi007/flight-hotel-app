import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, ChevronRight, Flag, Inbox } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { Initials } from '@/features/admin/dashboard/dashKit';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime } from '@/lib/format';
import { ListLoading } from '@/features/admin/shared/adminUi';
import { agentTicketApi } from './agentTicketApi';
import { attentionLabel } from './attention';
import { DeskCard, SeeAll, SupportHero } from './SupportKit';
import { supportApi } from './supportApi';
import { QueueTable } from './TicketQueuePage';
import type { SupportBookingFilters, TicketQueueFilters } from './types';

/** How many rows each section shows; the full lists are one click away. */
const SECTION_SIZE = 10;

const ESCALATED_TICKETS: TicketQueueFilters = {
  q: '', status: 'ESCALATED', category: '', priority: '', assigned: 'ANY', sort: 'lastMessageAt,asc', page: 0,
};
const FLAGGED_BOOKINGS: SupportBookingFilters = { q: '', status: '', type: '', attention: true, page: 0 };

/**
 * /support/escalations — everything that needs a senior look: escalated tickets and flagged bookings (refund failed,
 * cancellation refused, escalated by an agent, ...). Each section loads on its own, in its own card.
 */
export function EscalationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <EscalationsHero />
      <EscalatedTickets />
      <FlaggedBookings />
    </div>
  );
}

/** The hero shows both counts; the same cached requests as the sections below. */
function EscalationsHero() {
  const tickets = useQuery({
    queryKey: queryKeys.support.queueList({ ...ESCALATED_TICKETS, size: SECTION_SIZE }),
    queryFn: () => agentTicketApi.queue(ESCALATED_TICKETS, SECTION_SIZE),
  });
  const bookings = useQuery({
    queryKey: queryKeys.support.bookingSearch({ ...FLAGGED_BOOKINGS, size: SECTION_SIZE }),
    queryFn: () => supportApi.searchBookings(FLAGGED_BOOKINGS, SECTION_SIZE),
  });
  return (
    <SupportHero
      icon={Flag}
      title="Escalations"
      description="Escalated tickets and bookings that need attention. The ones waiting longest come first."
      actions={<span className="hidden rounded-full bg-white/15 px-2 py-1 ring-1 ring-inset ring-white/25 sm:inline-flex"><LiveIndicator /></span>}
      chips={[
        { label: 'Escalated tickets', value: tickets.data?.totalElements, icon: Inbox, urgent: true },
        { label: 'Flagged bookings', value: bookings.data?.totalElements, icon: AlertTriangle, urgent: true },
      ]}
    />
  );
}

function EscalatedTickets() {
  const tickets = useQuery({
    queryKey: queryKeys.support.queueList({ ...ESCALATED_TICKETS, size: SECTION_SIZE }),
    queryFn: () => agentTicketApi.queue(ESCALATED_TICKETS, SECTION_SIZE),
  });
  const data = tickets.data;
  return (
    <DeskCard tone="danger" icon={Flag} headingId="escalated-tickets-heading" title="Escalated tickets" count={data?.totalElements}
      action={<Link to="/support/tickets?status=ESCALATED"><SeeAll>See all in the ticket queue</SeeAll></Link>}>
      {tickets.isPending && <ListLoading label="Loading escalated tickets…" rows={2} />}
      {tickets.isError && <SectionError error={ApiError.from(tickets.error)} onRetry={() => void tickets.refetch()} />}
      {data && data.content.length === 0 && <EmptyState title="No escalated tickets" description="Nothing is waiting for a senior look." />}
      {data && data.content.length > 0 && <QueueTable rows={data.content} caption="Escalated tickets" />}
    </DeskCard>
  );
}

function FlaggedBookings() {
  const bookings = useQuery({
    queryKey: queryKeys.support.bookingSearch({ ...FLAGGED_BOOKINGS, size: SECTION_SIZE }),
    queryFn: () => supportApi.searchBookings(FLAGGED_BOOKINGS, SECTION_SIZE),
  });
  const data = bookings.data;
  return (
    <DeskCard tone="warning" icon={AlertTriangle} headingId="flagged-bookings-heading" title="Bookings that need attention" count={data?.totalElements}
      action={<Link to="/support/attention"><SeeAll>See the full queue</SeeAll></Link>}>
      {bookings.isPending && <ListLoading label="Loading bookings that need attention…" rows={2} />}
      {bookings.isError && <SectionError error={ApiError.from(bookings.error)} onRetry={() => void bookings.refetch()} />}
      {data && data.content.length === 0 && <EmptyState title="Nothing needs attention" description="No booking is flagged right now." />}
      {data && data.content.length > 0 && (
        <ul aria-label="Bookings that need attention" className="stagger grid gap-3 lg:grid-cols-2">
          {data.content.map((row) => (
            <li key={row.id} className="group relative flex h-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs transition-[transform,box-shadow,border-color] duration-(--duration-fast) focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-role-600 hover:-translate-y-0.5 hover:border-warning-300 hover:shadow-md motion-reduce:transform-none">
              <Initials email={row.contactEmail} />
              <div className="min-w-0 flex-1">
                {/* The reference is the link (its name); a stretched pseudo-element makes the whole card clickable. */}
                <Link to={`/support/bookings/${encodeURIComponent(row.id)}`} className="font-semibold text-role-700 outline-none after:absolute after:inset-0 after:rounded-2xl group-hover:underline">{row.reference}</Link>
                <span className="block break-words text-sm text-slate-700">{row.title ?? (row.type === 'FLIGHT' ? 'Flight' : 'Hotel stay')}</span>
                <span className="block break-all text-xs text-slate-500">{row.contactEmail}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {row.attentionReason && <Badge tone="danger" dot>{attentionLabel(row.attentionReason)}</Badge>}
                  {row.attentionSince && <span className="text-xs text-slate-500">since {formatDateTime(row.attentionSince)}</span>}
                </span>
              </div>
              <ChevronRight aria-hidden="true" className="mt-1 size-5 shrink-0 text-slate-300 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-role-600 motion-reduce:transform-none" />
            </li>
          ))}
        </ul>
      )}
    </DeskCard>
  );
}

function SectionError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return <ErrorState description={error.message} correlationId={error.correlationId} onRetry={onRetry} />;
}
