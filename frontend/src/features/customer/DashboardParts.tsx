import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  ArrowRight, BedDouble, Bell, CalendarDays, ChevronRight, CreditCard, LifeBuoy, Luggage, MapPin, Plane, Radio, Search,
  ShieldCheck, type LucideIcon,
} from 'lucide-react';

import { TravelHeroIllustration } from '@/components/illustrations';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { bookingApi } from '@/features/bookings/bookingApi';
import { BookingStatusBadge } from '@/features/bookings/BookingParts';
import { TripTypeIcon } from '@/features/bookings/BookingUi';
import { notificationApi } from '@/features/notifications/notificationApi';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { formatMoney, formatShortDate } from '@/lib/format';

/** How many of the latest bookings the dashboard lists (the rest is in My Trips). */
export const RECENT_BOOKINGS = 5;

interface QuickAction {
  to: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
}

const ACTIONS: QuickAction[] = [
  { to: '/flights', label: 'Search flights', hint: 'One way or round trip', icon: Plane, tone: 'bg-brand-50 text-brand-600 ring-brand-100' },
  { to: '/hotels', label: 'Search hotels', hint: 'Filter by free cancellation', icon: BedDouble, tone: 'bg-accent-50 text-accent-600 ring-accent-100' },
  { to: '/my-trips', label: 'My Trips', hint: 'Bookings, documents, cancellations', icon: Luggage, tone: 'bg-info-50 text-info-600 ring-info-100' },
  { to: '/account/support', label: 'Support tickets', hint: 'Ask us anything about a booking', icon: LifeBuoy, tone: 'bg-success-50 text-success-600 ring-success-100' },
  { to: '/account/notifications', label: 'Notifications', hint: 'Booking and payment updates', icon: Bell, tone: 'bg-warning-50 text-warning-600 ring-warning-100' },
];

/** Shortcuts to the customer's most used pages. The notifications entry shows the real unread count. */
export function QuickActions({ layout = 'list', className }: { layout?: 'list' | 'grid'; className?: string }) {
  const unread = useQuery({ queryKey: queryKeys.notifications.unreadCount, queryFn: notificationApi.unreadCount });
  return (
    <nav aria-labelledby="quick-actions-title" className={cn('rounded-3xl border border-slate-200/80 bg-white p-4 shadow-card sm:p-5', className)}>
      <h2 id="quick-actions-title" className="px-1 text-base font-bold tracking-tight text-slate-900">Quick actions</h2>
      <ul className={cn('mt-3 stagger', layout === 'grid' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5' : 'flex flex-col gap-1')}>
        {ACTIONS.map((action) => {
          const count = action.to === '/account/notifications' ? unread.data ?? 0 : 0;
          const Icon = action.icon;
          return (
            <li key={action.to}>
              {/* Grid: a tile (icon on top, text below), so five fit in a row beside the sidebar; list: one row each. */}
              <Link
                to={action.to}
                className={cn(
                  'group relative flex gap-3 rounded-2xl transition-colors duration-(--duration-fast)',
                  layout === 'grid'
                    ? 'h-full flex-col items-start border border-slate-200/80 bg-white p-4 shadow-xs hover-lift hover:border-brand-200'
                    : 'items-center p-2.5 hover:bg-slate-50',
                )}
              >
                <span aria-hidden="true" className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', action.tone)}>
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 group-hover:text-brand-700">
                    {action.label}
                    {count > 0 && (
                      <Badge tone="danger" className={layout === 'grid' ? 'absolute right-3 top-3' : undefined}>
                        {count} unread
                      </Badge>
                    )}
                  </span>
                  <span className="block text-xs leading-snug text-slate-500">{action.hint}</span>
                </span>
                {layout === 'list' && (
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-slate-400 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The latest bookings from My Trips (any status), newest first, with their status and a link to each. */
export function RecentBookings() {
  const trips = useQuery({
    queryKey: queryKeys.bookings.list({ tab: 'ALL', page: 0, size: RECENT_BOOKINGS }),
    queryFn: () => bookingApi.list('ALL', 0, RECENT_BOOKINGS),
  });
  return (
    <section aria-labelledby="recent-bookings-title" className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="recent-bookings-title" className="text-lg font-bold tracking-tight text-slate-900">Recent bookings</h2>
          <p className="mt-0.5 text-sm text-slate-600">Your latest bookings, newest first.</p>
        </div>
        <ButtonLink to="/my-trips" variant="ghost" size="sm">
          All trips <ArrowRight className="size-4" aria-hidden="true" />
        </ButtonLink>
      </div>
      <div className="mt-4">
        {trips.isPending && (
          <div className="flex flex-col gap-3">
            <span role="status" className="sr-only">Loading recent bookings…</span>
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16 rounded-2xl" />)}
          </div>
        )}
        {trips.isError && (
          <ErrorState compact title="Recent bookings could not be loaded" description={ApiError.from(trips.error).message}
            correlationId={ApiError.from(trips.error).correlationId} onRetry={() => void trips.refetch()} />
        )}
        {trips.data && trips.data.content.length === 0 && (
          <EmptyState compact illustration="none" title="No bookings yet" description="Bookings you make appear here straight away." />
        )}
        {trips.data && trips.data.content.length > 0 && (
          <ul aria-label="Recent bookings" className="flex flex-col divide-y divide-slate-100 stagger">
            {trips.data.content.map((trip) => (
              <li key={trip.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <TripTypeIcon type={trip.type} />
                <div className="min-w-0 flex-1">
                  <Link to={`/my-trips/${trip.id}`} className="font-semibold text-slate-900 hover:text-brand-700 hover:underline">
                    {trip.title ?? (trip.type === 'FLIGHT' ? 'Flight booking' : 'Hotel booking')}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
                    {trip.destination && (
                      <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden="true" />{trip.destination}</span>
                    )}
                    {trip.startDate && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="size-3.5" aria-hidden="true" />
                        {trip.endDate && trip.endDate !== trip.startDate
                          ? `${formatShortDate(trip.startDate)} to ${formatShortDate(trip.endDate)}`
                          : formatShortDate(trip.startDate)}
                      </span>
                    )}
                    <span>Reference {trip.reference}</span>
                  </p>
                </div>
                <div className="col-start-2 flex flex-wrap items-center gap-3 sm:col-start-3 sm:flex-col sm:items-end sm:gap-1">
                  {trip.totalAmount > 0 && <span className="text-sm font-bold text-slate-900">{formatMoney(trip.totalAmount, trip.currency, true)}</span>}
                  <BookingStatusBadge status={trip.status} type={trip.type} paymentStatus={trip.paymentStatus} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The dashboard of a customer who has not booked yet: an invitation instead of a wall of zeros. */
export function WelcomePanel() {
  return (
    <section aria-labelledby="welcome-title" className="relative isolate overflow-hidden rounded-3xl bg-gradient-dusk text-white shadow-xl animate-fade-up">
      <div aria-hidden="true" className="pointer-events-none absolute -left-20 -top-24 -z-10 size-80 rounded-full bg-brand-500/30 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-10 -z-10 size-72 rounded-full bg-accent-500/20 blur-3xl" />
      <div className="grid items-center gap-6 p-6 sm:p-10 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent-100 ring-1 ring-white/20">
            Your first trip
          </p>
          <h2 id="welcome-title" className="mt-4 text-2xl font-bold tracking-tight text-balance sm:text-3xl">Your first trip starts here</h2>
          <p className="mt-3 max-w-lg text-base leading-relaxed text-brand-50">
            Search flights and hotels, pay securely and follow every booking live. Once you book, this page shows your
            next trip, your bookings and your spending.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink to="/flights" variant="accent" size="lg"><Plane className="size-5" aria-hidden="true" />Search flights</ButtonLink>
            <ButtonLink to="/hotels" size="lg" variant="secondary">
              <BedDouble className="size-5" aria-hidden="true" />Search hotels
            </ButtonLink>
          </div>
        </div>
        <div aria-hidden="true" className="hidden md:block">
          <div className="animate-float">
            <TravelHeroIllustration className="w-full max-w-md justify-self-end rounded-3xl shadow-2xl" />
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Search, title: 'Search and compare', text: 'Flights and hotels side by side, with filters for refundable fares and free cancellation.' },
  { icon: CreditCard, title: 'Book and pay securely', text: 'Your seats or room are held at the quoted price while you pay with the secure payment provider.' },
  { icon: Radio, title: 'Follow it live', text: 'Confirmations, documents and refunds update on their own, here and in My Trips.' },
  { icon: ShieldCheck, title: 'Help when you need it', text: 'Open a support ticket about any booking and follow the conversation in your account.' },
];

/** What booking here involves (facts about the product, never figures). */
export function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works-title">
      <h2 id="how-it-works-title" className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">How it works</h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 stagger">
        {STEPS.map(({ icon: Icon, title, text }, index) => (
          <li key={title}>
            <Card className="flex h-full flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
                  <Icon className="size-5" />
                </span>
                <span className="text-xs font-bold text-slate-500">Step {index + 1}</span>
              </div>
              <h3 className="text-base font-bold text-slate-900">{title}</h3>
              <p className="text-sm leading-relaxed text-slate-600">{text}</p>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}
