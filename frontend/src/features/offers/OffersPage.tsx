import { useQuery } from '@tanstack/react-query';
import { ClipboardCopy, Search, Ticket, type LucideIcon } from 'lucide-react';

import { Reveal } from '@/components/motion/Reveal';
import { SuitcaseIllustration } from '@/components/illustrations';
import { PageHero } from '@/components/layout/PageHero';
import { ButtonLink } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { offerApi, OFFERS_STALE_MS } from './offerApi';
import { OfferCard } from './OfferCard';

/** How a coupon is used, in the order the customer does it. */
const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: ClipboardCopy, title: 'Copy a code', text: 'Pick an offer below and copy its code.' },
  { icon: Search, title: 'Search and choose', text: 'Find the flight or stay the offer applies to.' },
  { icon: Ticket, title: 'Enter it when you book', text: 'Add the code on the review step; the discount shows before you pay.' },
];

/** /offers — current offers and seasonal promotions with their coupon codes. */
export function OffersPage() {
  const offers = useQuery({ queryKey: queryKeys.publicContent.offers, queryFn: offerApi.list, staleTime: OFFERS_STALE_MS });
  const error = offers.isError ? ApiError.from(offers.error) : null;

  return (
    <div className="pb-20">
      <PageHero
        tone="sky"
        eyebrow="Deals and promotions"
        title="Offers"
        description="Current deals and seasonal promotions. Copy a code and enter it when you book; the discount is shown before you pay."
        illustration={<div className="w-52 lg:w-60"><SuitcaseIllustration /></div>}
      />

      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 sm:pt-10">
        {offers.isPending && (
          <div>
            <span role="status" className="sr-only">Loading offers…</span>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
                  <Skeleton className="h-24 rounded-none" />
                  <div className="flex flex-col gap-2 p-5">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="mt-4 h-9 w-full rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <ErrorState description={error.message} correlationId={error.correlationId} onRetry={() => void offers.refetch()} />}
        {offers.data && offers.data.length === 0 && (
          <EmptyState
            title="No offers right now"
            description="New deals appear here. You can still search and book at the regular price."
            action={(
              <>
                <ButtonLink to="/hotels" size="sm">Search hotels</ButtonLink>
                <ButtonLink to="/flights" variant="secondary" size="sm">Search flights</ButtonLink>
              </>
            )}
          />
        )}
        {offers.data && offers.data.length > 0 && (
          <ul className="grid gap-5 stagger sm:grid-cols-2 lg:grid-cols-3" aria-label="Offers">
            {offers.data.map((offer) => <li key={offer.id}><OfferCard offer={offer} headingLevel={2} /></li>)}
          </ul>
        )}

        <Reveal as="section" aria-labelledby="offers-how" className="mt-14 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-card sm:p-8">
          <h2 id="offers-how" className="text-xl font-bold tracking-tight text-slate-900">How to use a code</h2>
          <ol className="mt-5 grid gap-5 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className="flex items-start gap-3">
                <span aria-hidden="true" className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                  <Icon className="size-5" />
                  <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-brand-600 text-[0.6875rem] font-bold text-white">
                    {index + 1}
                  </span>
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                  <p className="mt-0.5 text-sm text-slate-600">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </div>
  );
}
