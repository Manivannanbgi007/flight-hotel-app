import { PenLine, Star } from 'lucide-react';

import { ButtonLink } from '@/components/ui/Button';
import { mayBeReviewable, useEligibleStays, writeReviewPath } from './useReviews';

/**
 * "How was your stay?" on a booking's page: shown only when the server lists the stay as reviewable. Nothing at all
 * while loading, on errors, or for stays that cannot be reviewed.
 */
export function ReviewPrompt({ booking }: {
  booking: { id: string; type: 'HOTEL' | 'FLIGHT'; status: string; endDate: string | null; title: string | null };
}) {
  const possible = mayBeReviewable(booking);
  const eligible = useEligibleStays(possible);
  if (!possible || !eligible.data?.some((stay) => stay.bookingId === booking.id)) {
    return null;
  }
  return (
    <section aria-labelledby={`review-prompt-${booking.id}`} className="relative overflow-hidden rounded-2xl border border-accent-200 bg-accent-50 p-5 shadow-card animate-fade-in">
      <div aria-hidden="true" className="pointer-events-none absolute -right-3 -top-3 flex gap-0.5 text-accent-300 opacity-70">
        {[0, 1, 2].map((i) => <Star key={i} className="size-6 fill-current" />)}
      </div>
      <h2 id={`review-prompt-${booking.id}`} className="flex items-center gap-2 font-bold text-slate-900">
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-accent-100 text-accent-700">
          <PenLine className="size-4" />
        </span>
        How was your stay?
      </h2>
      <p className="mt-2 text-sm text-slate-700">Your review helps other travellers choose.</p>
      <ButtonLink to={writeReviewPath(booking.id)} variant="accent" size="sm" className="mt-4">
        Write a review
      </ButtonLink>
    </section>
  );
}
