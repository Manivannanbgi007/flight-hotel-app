import { Link } from 'react-router';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { Activity, BedDouble, Ban, CircleCheck, CircleX, CreditCard, Hourglass, Info, LifeBuoy, Luggage, Plane, RotateCcw, UserPlus, type LucideIcon } from 'lucide-react';

import { formatINR } from '@/components/charts';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/StateViews';
import { BookingStatusBadge } from '@/features/bookings/BookingParts';
import { statusInfo } from '@/features/bookings/status';
import type { BookingStatus } from '@/features/bookings/types';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { Initials, DashSection, ViewAll } from './dashKit';
import type { AdminDashboard, TimelineEvent, TimelineOutcome } from './dashboardApi';

function ListLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3">
      <span role="status" className="sr-only">{label}</span>
      {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-14 rounded-2xl" />)}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------- recent bookings

/**
 * Recent bookings: the newest bookings created in the range with their customer, type, destination, date, amount and
 * status. A table from `md`, cards below it. Each row opens the booking.
 */
export function RecentBookingsSection({ data }: { data?: AdminDashboard }) {
  const bookings = data?.recentBookings ?? [];
  return (
    <DashSection
      id="recent-bookings"
      title="Recent bookings"
      description="The newest bookings created in the range"
      icon={<Luggage />}
      accent="blue"
      className="h-full"
      action={<ViewAll to="/admin/bookings" label="View all" permission="BOOKING_READ_ANY" />}
    >
      {!data && <ListLoading label="Loading recent bookings…" />}
      {data && bookings.length === 0 && (
        <EmptyState compact illustration="none" title="No bookings in this range" description="Choose a longer range to see more." />
      )}
      {data && bookings.length > 0 && (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[34rem] border-separate border-spacing-y-2 text-sm">
              <caption className="sr-only">Recent bookings</caption>
              <thead>
                <tr className="text-left text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-3 pb-1">Booking</th>
                  <th scope="col" className="px-3 pb-1">Customer</th>
                  <th scope="col" className="px-3 pb-1">Destination</th>
                  <th scope="col" className="px-3 pb-1">Date</th>
                  <th scope="col" className="px-3 pb-1 text-right">Amount</th>
                  <th scope="col" className="px-3 pb-1">Status</th>
                </tr>
              </thead>
              <tbody className="stagger">
                {bookings.map((booking) => (
                  <tr key={booking.id} className="group bg-white shadow-xs ring-1 ring-slate-200/80 transition-[transform,box-shadow] duration-(--duration-fast) hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-200">
                    <td className="rounded-l-xl px-3 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <TypeTile type={booking.type} />
                        <span className="min-w-0">
                          <Link to={`/admin/bookings/${booking.id}`} className="block font-semibold text-role-700 hover:underline">{booking.reference}</Link>
                          <span className="block max-w-44 truncate text-xs text-slate-500">{booking.type === 'HOTEL' ? 'Hotel' : 'Flight'}{booking.title ? ` · ${booking.title}` : ''}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5"><CustomerCell name={booking.customerName} email={booking.customerEmail} /></td>
                    <td className="max-w-36 truncate px-3 py-2.5 text-slate-700">{booking.destination ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{formatDateTime(booking.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums text-slate-900">{formatINR(booking.totalAmount)}</td>
                    <td className="rounded-r-xl px-3 py-2.5"><StatusBadge status={booking.status} type={booking.type} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul aria-label="Recent bookings" className="stagger flex flex-col gap-3 md:hidden">
            {bookings.map((booking) => (
              <li key={booking.id} className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs transition-shadow duration-(--duration-fast) hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <TypeTile type={booking.type} />
                    <span className="min-w-0">
                      <Link to={`/admin/bookings/${booking.id}`} className="block font-semibold text-role-700 hover:underline">{booking.reference}</Link>
                      <span className="block truncate text-xs text-slate-500">{booking.destination ?? booking.title ?? ''}</span>
                    </span>
                  </span>
                  <span className="text-sm font-bold tabular-nums text-slate-900">{formatINR(booking.totalAmount)}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <CustomerCell name={booking.customerName} email={booking.customerEmail} small />
                  <StatusBadge status={booking.status} type={booking.type} />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">{formatDateTime(booking.createdAt)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </DashSection>
  );
}

function TypeTile({ type }: { type: 'HOTEL' | 'FLIGHT' }) {
  return (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', type === 'FLIGHT' ? 'bg-info-50 text-info-600 ring-info-200' : 'bg-brand-50 text-brand-600 ring-brand-100')}>
      {type === 'FLIGHT' ? <Plane role="img" aria-label="Flight" className="size-4" /> : <BedDouble role="img" aria-label="Hotel" className="size-4" />}
    </span>
  );
}

function CustomerCell({ name, email, small = false }: { name: string | null; email: string | null; small?: boolean }) {
  if (!name && !email) return <span className="text-slate-400">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Initials name={name} email={email} className={small ? 'size-7 text-xs' : 'size-8 text-xs'} />
      <span className="min-w-0">
        <span className="block max-w-40 truncate text-sm font-medium text-slate-800">{name ?? email}</span>
        {name && email && !small && <span className="block max-w-40 truncate text-xs text-slate-500">{email}</span>}
      </span>
    </span>
  );
}

function StatusBadge({ status, type }: { status: string; type: 'HOTEL' | 'FLIGHT' }) {
  return status in statusInfo
    ? <BookingStatusBadge status={status as BookingStatus} type={type} />
    : <Badge>{status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}</Badge>;
}

// ----------------------------------------------------------------------------------------------------------- timeline

const OUTCOME: Record<TimelineOutcome, { label: string; icon: LucideIcon; node: string; chip: 'success' | 'warning' | 'danger' | 'info' }> = {
  SUCCESS: { label: 'Successful', icon: CircleCheck, node: 'bg-success-50 text-success-600 ring-success-200', chip: 'success' },
  PENDING: { label: 'Pending', icon: Hourglass, node: 'bg-warning-50 text-warning-600 ring-warning-200', chip: 'warning' },
  FAILED: { label: 'Failed', icon: CircleX, node: 'bg-danger-50 text-danger-600 ring-danger-200', chip: 'danger' },
  CANCELLED: { label: 'Cancelled', icon: Ban, node: 'bg-danger-50 text-danger-600 ring-danger-200', chip: 'danger' },
  INFO: { label: 'Update', icon: Info, node: 'bg-info-50 text-info-600 ring-info-200', chip: 'info' },
};

/** The icon of the kind of event (the outcome is shown by the colour and the chip). */
function typeIcon(event: TimelineEvent): LucideIcon {
  if (event.type === 'CUSTOMER_REGISTERED') return UserPlus;
  if (event.type === 'BOOKING_CREATED') return event.title.startsWith('Flight') ? Plane : BedDouble;
  if (event.type === 'BOOKING_CANCELLED') return Ban;
  if (event.type.startsWith('PAYMENT')) return CreditCard;
  if (event.type === 'SUPPORT_TICKET') return LifeBuoy;
  if (event.type.includes('REFUND')) return RotateCcw;
  return Activity;
}

/** Where an event opens, when there is a page for it. */
function eventLink(event: TimelineEvent): string | null {
  switch (event.entityType) {
    case 'USER': return `/admin/users/${event.entityId}`;
    case 'BOOKING': return `/admin/bookings/${event.entityId}`;
    case 'PAYMENT': return `/admin/payments/${event.entityId}`;
    case 'TICKET': return `/support/tickets/${event.entityId}`;
    default: return null;
  }
}

/**
 * Recent activity as a timeline: new customers, bookings, cancellations, payments, refunds and support tickets, newest
 * first. The colour and the chip say how each ended (successful, pending, failed, cancelled, or just an update).
 */
export function ActivitySection({ data }: { data?: AdminDashboard }) {
  const events = data?.timeline ?? [];
  return (
    <DashSection
      id="recent-activity"
      title="Recent activity"
      description="What happened lately: customers, bookings, payments and support"
      icon={<Activity />}
      accent="purple"
      className="h-full"
      action={<ViewAll to="/admin/audit-logs" label="Audit logs" permission="AUDIT_VIEW" />}
    >
      {!data && <ListLoading label="Loading recent activity…" />}
      {data && events.length === 0 && (
        <EmptyState compact illustration="none" title="Nothing happened in this range" description="Choose a longer range to see more." />
      )}
      {data && events.length > 0 && (
        <ol aria-label="Recent activity" className="relative flex flex-col">
          <span aria-hidden="true" className="absolute bottom-4 left-[1.125rem] top-4 w-px bg-gradient-to-b from-role-200 via-slate-200 to-transparent" />
          {events.map((event, index) => {
            const outcome = OUTCOME[event.outcome] ?? OUTCOME.INFO;
            const Icon = typeIcon(event);
            const link = eventLink(event);
            const when = parseISO(event.at);
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-slate-900">{event.title}</span>
                    <Badge tone={outcome.chip}>{outcome.label}</Badge>
                  </span>
                  {event.detail && <span className="block truncate text-xs text-slate-600">{event.detail}</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                  {event.amount !== null && event.amount > 0 && <span className="text-sm font-bold tabular-nums text-slate-900">{formatINR(event.amount)}</span>}
                  <time dateTime={event.at} title={formatDateTime(event.at)} className="text-xs text-slate-500">{formatDistanceToNowStrict(when, { addSuffix: true })}</time>
                </span>
              </>
            );
            return (
              <li key={`${event.at}-${event.type}-${event.entityId}-${index}`} className="relative animate-fade-up" style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
                {link ? (
                  <Link to={link} className="group flex items-start gap-3 rounded-2xl p-2 transition-colors duration-(--duration-fast) hover:bg-slate-50">
                    <Node icon={Icon} outcome={event.outcome} />
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 p-2">
                    <Node icon={Icon} outcome={event.outcome} />
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </DashSection>
  );
}

function Node({ icon: Icon, outcome }: { icon: LucideIcon; outcome: TimelineOutcome }) {
  const style = OUTCOME[outcome] ?? OUTCOME.INFO;
  return (
    <span aria-hidden="true" className={cn('relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition-transform duration-(--duration-fast) group-hover:scale-110', style.node)}>
      <Icon className="size-4" />
    </span>
  );
}
