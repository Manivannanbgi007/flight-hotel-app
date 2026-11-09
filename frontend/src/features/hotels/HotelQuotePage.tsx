import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ArrowRight, BedDouble, ConciergeBell, MapPin, ShieldCheck, ShieldOff, Users, WalletCards } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/StateViews';
import { HoldTimer, StayCover, StayTimeline } from '@/features/bookings/CheckoutParts';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { formatMoney, formatShortDate } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import { DemoBadge } from './HotelBadges';
import { hotelApi } from './hotelApi';
import { describeGuests, stayParams } from './searchParams';
import type { Quote } from './types';

/**
 * /hotels/quote/:quoteId — the re-checked price the customer will book (valid 15 minutes). "Continue" starts the
 * booking: guest details, review, payment (login needed from here).
 *
 * Layout: the stay (photo, dates, room) and the price card side by side from laptop width, the price card staying in
 * view; on phones the price card comes right after the stay, so "Continue" is never far away.
 */
export function HotelQuotePage() {
  const { quoteId = '' } = useParams();
  const quote = useQuery({
    queryKey: queryKeys.hotels.quote(quoteId),
    queryFn: () => hotelApi.getQuote(quoteId),
    retry: false,
    staleTime: Infinity,
  });

  if (quote.isPending) {
    return (
      <PageContainer width="lg">
        <span role="status" className="sr-only">Loading your stay…</span>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-9 w-64" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="flex flex-col gap-6">
            <Skeleton className="h-[26rem] w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-[28rem] w-full rounded-2xl" />
        </div>
      </PageContainer>
    );
  }
  if (quote.isError) {
    const error = ApiError.from(quote.error);
    return (
      <PageContainer width="md">
        <div className="py-6 sm:py-10">
        {error.status === 404 ? (
          <ErrorState title="This price has expired" description="Prices are held for 15 minutes. Please check availability again." />
        ) : (
          <ErrorState description={error.message} onRetry={() => void quote.refetch()} />
        )}
        <p className="mt-6 text-center">
          <ButtonLink to="/hotels" variant="secondary">Search hotels</ButtonLink>
        </p>
        </div>
      </PageContainer>
    );
  }
  return <QuoteSummary quote={quote.data} />;
}

function QuoteSummary({ quote }: { quote: Quote }) {
  const remaining = useCountdown(quote.expiresAt);
  const expired = remaining <= 0;
  const held = Math.round((new Date(quote.expiresAt).getTime() - new Date(quote.createdAt).getTime()) / 1000) || 15 * 60;
  const stay = { checkIn: quote.checkIn, checkOut: quote.checkOut, rooms: quote.rooms, adults: quote.adults,
    children: quote.children, childAges: quote.childAges };
  const backToHotel = `/hotels/${quote.hotelSlug}?${stayParams(stay).toString()}#rooms`;

  return (
    <PageContainer width="lg">
      <PageHeader
        eyebrow="Your hotel"
        title="Review your stay"
        description="Check the dates, the room and the price. You enter the guest details next."
      />
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:grid-rows-[auto_1fr]">
        {/* 1. The stay: photo, dates, room and guests. */}
        <Card className="min-w-0 overflow-hidden animate-fade-up lg:col-start-1 lg:row-start-1">
          <StayCover slug={quote.hotelSlug}>
            <div className="py-6 pl-5 sm:py-8 sm:pl-7">
              {quote.demo && <DemoBadge className="mb-3 animate-pop" />}
              <h2 className="text-2xl font-bold tracking-tight text-balance text-white sm:text-[1.75rem] sm:leading-tight">{quote.hotelName}</h2>
              <p className="mt-2 flex items-start gap-1.5 text-sm text-white/90">
                <MapPin className="mt-0.5 size-4 shrink-0 text-white" aria-hidden="true" />
                <span>{quote.hotelAddress}</span>
              </p>
            </div>
          </StayCover>
          <div className="p-5 sm:p-6">
            <StayTimeline checkIn={quote.checkIn} checkOut={quote.checkOut} checkInTime={quote.checkInTime}
              checkOutTime={quote.checkOutTime} nights={quote.nights} />
            <dl className="mt-4 grid gap-3 sm:grid-cols-3 stagger">
              <Fact icon={<BedDouble className="size-4" />} term="Room">{quote.roomTypeName}</Fact>
              <Fact icon={<ConciergeBell className="size-4" />} term="Rate">{quote.ratePlanName}</Fact>
              <Fact icon={<Users className="size-4" />} term="Guests">{describeGuests(quote)}</Fact>
            </dl>
          </div>
        </Card>

        {/* 2. The price, the hold timer and "Continue" (on the right from laptop width, staying in view). */}
        <Card variant="elevated" className="h-fit min-w-0 animate-fade-up [animation-delay:120ms] lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="p-5 sm:p-6">
            <HoldTimer
              remaining={remaining}
              total={held}
              label="Price held for"
              deadline={quote.expiresAt}
              note="After that we check the price again."
              expiredText="This price has expired."
              expiredNote="Prices are held for 15 minutes."
            />
            <section aria-labelledby="quote-price-title" className="mt-5">
              <h2 id="quote-price-title" className="text-base font-bold tracking-tight text-slate-900">Price details</h2>
              <ul className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
                {quote.nightlyPrices.map((night) => (
                  <li key={night.date} className="flex justify-between gap-3">
                    <span className="min-w-0">{formatShortDate(night.date)}{night.season ? ` · ${night.season}` : ''}{quote.rooms > 1 ? ` × ${quote.rooms}` : ''}</span>
                    <span className="shrink-0 tabular-nums">{formatMoney(night.price * quote.rooms, quote.currency, true)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 flex flex-col gap-2 border-t border-dashed border-slate-200 pt-3 text-sm">
                <div className="flex justify-between gap-3 text-slate-700"><dt>Subtotal</dt><dd className="tabular-nums">{formatMoney(quote.subtotal, quote.currency, true)}</dd></div>
                {quote.taxLines.map((line) => (
                  <div key={line.label} className="flex justify-between gap-3 text-slate-600">
                    <dt>{line.label}</dt><dd className="tabular-nums">{formatMoney(line.amount, quote.currency, true)}</dd>
                  </div>
                ))}
                <div className="sheen-sweep mt-2 flex items-baseline justify-between gap-3 rounded-2xl bg-[linear-gradient(135deg,var(--role-950),var(--role-800)_60%,var(--role-700))] px-4 py-3.5 text-white shadow-glow">
                  <dt className="text-base font-bold">Total</dt>
                  <dd className="text-2xl font-bold tracking-tight tabular-nums">{formatMoney(quote.total, quote.currency, true)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-right text-xs text-slate-600">Taxes included</p>
            </section>

            {expired ? (
              <p className="mt-5 rounded-xl bg-slate-100 px-4 py-3 text-center text-sm text-slate-700">Check availability again to book.</p>
            ) : (
              <ButtonLink to={`/book/hotel/${quote.quoteId}`} size="lg" className="sheen-sweep group mt-5 h-13 w-full text-[1.0625rem]">
                Continue to guest details
                <ArrowRight className="size-5 transition-transform duration-(--duration-base) group-hover:translate-x-1" aria-hidden="true" />
              </ButtonLink>
            )}
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-600">
              <WalletCards className="size-4 shrink-0 text-current" aria-hidden="true" />
              Nothing to pay yet. You pay at the last step.
            </p>
            <Link to={backToHotel} className="mt-4 block rounded-md text-center text-sm font-semibold text-role-700 hover:underline">
              {expired ? 'Check availability again' : 'Change room or dates'}
            </Link>
          </div>
        </Card>

        {/* 3. Cancellation terms and what happens next. */}
        <div className="flex min-w-0 flex-col gap-6 stagger lg:col-start-1 lg:row-start-2">
          <CancellationCard free={quote.freeCancellation} policy={quote.cancellationPolicy} />
          <NextSteps />
        </div>
      </div>
    </PageContainer>
  );
}

/** A fact of the stay: the icon sits in the term, so dt and dd stay direct children of the group (valid dl). */
function Fact({ icon, term, children }: { icon: ReactNode; term: string; children: ReactNode }) {
  return (
    <div className="relative min-w-0 rounded-2xl py-3 pl-15 pr-3 ring-1 ring-inset ring-slate-200/70 transition-shadow duration-(--duration-base) hover:shadow-md">
      <dt className="text-xs font-semibold text-slate-600">
        <span aria-hidden="true" className="absolute left-3 top-3 flex size-9 items-center justify-center rounded-xl bg-role-50 text-role-600 ring-1 ring-inset ring-role-100">
          {icon}
        </span>
        {term}
      </dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

function CancellationCard({ free, policy }: { free: boolean; policy: string }) {
  return (
    <div
      className={cn(
        'relative isolate flex items-start gap-4 overflow-hidden rounded-2xl border p-5 shadow-card sm:p-6',
        free ? 'border-success-200 bg-gradient-to-br from-success-50 to-white' : 'border-slate-200/80 bg-white',
      )}
    >
      {free && <div aria-hidden="true" className="absolute -right-10 -top-10 -z-10 size-40 rounded-full bg-success-100/70 blur-2xl" />}
      <span
        aria-hidden="true"
        className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset animate-pop [animation-delay:300ms]',
          free ? 'bg-success-600 text-white ring-success-700/20 shadow-[0_8px_20px_-8px_var(--color-success-600)]' : 'bg-slate-100 text-slate-600 ring-slate-200')}
      >
        {free ? <ShieldCheck className="size-5 text-current" /> : <ShieldOff className="size-5 text-current" />}
      </span>
      <div className="min-w-0">
        <h2 className="text-base font-bold text-slate-900">{free ? 'Free cancellation' : 'Cancellation'}</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-700">{policy}</p>
      </div>
    </div>
  );
}

const NEXT_STEPS = [
  { title: 'Guest details', text: 'Who is staying and how to reach you' },
  { title: 'Review', text: 'Check everything once more' },
  { title: 'Payment', text: 'Pay securely to confirm' },
];

/** The three steps after this page, the first one highlighted. */
function NextSteps() {
  return (
    <section aria-labelledby="quote-next-title" className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card sm:p-6">
      <h2 id="quote-next-title" className="text-base font-bold text-slate-900">What happens next</h2>
      <div className="relative mt-4">
        <span aria-hidden="true" className="absolute bottom-9 left-[1.0625rem] top-9 w-px bg-slate-200 sm:hidden" />
        <span aria-hidden="true" className="absolute left-9 right-9 top-[1.0625rem] hidden h-px origin-left animate-draw-x bg-slate-200 sm:block" />
        <ol className="relative grid gap-4 sm:grid-cols-3 sm:gap-3">
          {NEXT_STEPS.map((step, index) => (
            <li key={step.title} className="relative flex items-start gap-3 sm:flex-col sm:gap-2.5">
              <span
                aria-hidden="true"
                className={cn('relative flex size-[2.125rem] shrink-0 items-center justify-center rounded-full text-sm font-bold ring-4 ring-white',
                  index === 0 ? 'bg-role-600 text-white shadow-glow' : 'bg-slate-100 text-slate-600')}
              >
                {index === 0 && <span className="absolute inset-0 rounded-full bg-role-500/40 opacity-0 animate-halo" />}
                <span className="relative">{index + 1}</span>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">{step.title}</span>
                <span className="block text-xs leading-relaxed text-slate-600">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
