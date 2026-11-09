import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { BedDouble, CalendarDays, CircleCheck, Hourglass, ListChecks, PenLine, Search, Star } from 'lucide-react';

import { KpiGrid, KpiItem } from '@/components/analytics';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Skeleton } from '@/components/ui/Skeleton';
import { StarScore } from '@/components/ui/StarRatingInput';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { SectionHeader } from '@/features/account/AccountLayout';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDate } from '@/lib/format';
import { reviewApi } from './reviewApi';
import { reviewStatusInfo } from './reviewText';
import type { EligibleStay, MyReview, ReviewStatus } from './types';
import { useEligibleStays, writeReviewPath } from './useReviews';

/**
 * /account/reviews — stays waiting for a review, and my reviews with their moderation status (and why one was not
 * published). Live updates (`review.changed`) refresh both.
 */
export function MyReviewsPage() {
  const eligible = useEligibleStays();
  const mine = useQuery({ queryKey: queryKeys.reviews.mine, queryFn: reviewApi.mine });
  // My own reviews are a short list the API returns whole, so searching and filtering it needs no request.
  const [text, setText] = useState('');
  const [status, setStatus] = useState<ReviewStatus | ''>('');
  const words = text.trim().toLowerCase();
  const shown = (mine.data ?? []).filter((review) =>
    (!status || review.status === status)
    && (!words || [review.title, review.text, review.hotelName, review.bookingReference].some((field) => field?.toLowerCase().includes(words))));
  const all = mine.data ?? [];
  const average = all.length ? all.reduce((sum, review) => sum + review.rating, 0) / all.length : null;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="to-review-heading">
        <SectionHeader title="My reviews" description="Tell other travellers about your hotel stays." action={<LiveIndicator />} />
        <h3 id="to-review-heading" className="mb-3 text-base font-bold text-slate-900">Stays to review</h3>
        {eligible.isPending && <RowsLoading label="Loading stays to review…" rows={1} />}
        {eligible.isError && <LoadError error={eligible.error} onRetry={() => void eligible.refetch()} />}
        {eligible.data && eligible.data.length === 0 && (
          <p className="flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-4 text-sm text-slate-600">
            <Hourglass className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
            No stays to review right now. You can review a hotel stay after check-out.
          </p>
        )}
        {eligible.data && eligible.data.length > 0 && (
          <ul className="flex flex-col gap-3 stagger" aria-label="Stays to review">
            {eligible.data.map((stay) => <StayRow key={stay.bookingId} stay={stay} />)}
          </ul>
        )}
      </section>

      <section aria-labelledby="my-reviews-heading">
        <h3 id="my-reviews-heading" className="mb-3 text-base font-bold text-slate-900">Your reviews</h3>
        {all.length > 0 && (
          <>
            <KpiGrid label="Review figures" columns={3} className="mb-4">
              <KpiItem><StatCard label="Reviews written" value={all.length} icon={<ListChecks className="size-5" />} /></KpiItem>
              <KpiItem><StatCard label="Published" value={all.filter((review) => review.status === 'APPROVED').length} icon={<CircleCheck className="size-5" />} footer="Visible on the hotel page" /></KpiItem>
              <KpiItem>
                <StatCard label="Your average rating" value={average === null ? '' : `${average.toFixed(1)} / 5`} icon={<Star className="size-5" />}
                  footer={`${all.filter((review) => review.status === 'PENDING').length} waiting for approval`} />
              </KpiItem>
            </KpiGrid>
            <div className="mb-4 grid gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card sm:grid-cols-[minmax(0,1fr)_14rem] sm:p-4">
              <div className="relative">
                <label htmlFor="review-search" className="sr-only">Search my reviews</label>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input id="review-search" type="search" value={text} onChange={(event) => setText(event.target.value)}
                  placeholder="Search by hotel, title, words or booking" autoComplete="off"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-500 hover:border-slate-300 focus:border-role-400 focus:ring-4 focus:ring-role-500/15 focus-visible:outline-none" />
              </div>
              <SelectField label="Status" value={status} onChange={(event) => setStatus(event.target.value as ReviewStatus | '')}>
                <option value="">All reviews</option>
                {(Object.keys(reviewStatusInfo) as ReviewStatus[]).map((value) => <option key={value} value={value}>{reviewStatusInfo[value].label}</option>)}
              </SelectField>
            </div>
          </>
        )}
        {mine.isPending && <RowsLoading label="Loading your reviews…" rows={2} />}
        {mine.isError && <LoadError error={mine.error} onRetry={() => void mine.refetch()} />}
        {mine.data && mine.data.length === 0 && (
          <EmptyState compact title="No reviews yet" description="Reviews you write appear here with their status." />
        )}
        {mine.data && mine.data.length > 0 && shown.length === 0 && (
          <EmptyState compact illustration="search" title="No reviews match" description="Try other words, or show all statuses." />
        )}
        {shown.length > 0 && (
          <ul className="flex flex-col gap-3 stagger" aria-label="Your reviews">
            {shown.map((review) => <ReviewRow key={review.id} review={review} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function RowsLoading({ label, rows }: { label: string; rows: number }) {
  return (
    <div className="flex flex-col gap-3">
      <span role="status" className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
    </div>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const problem = ApiError.from(error);
  return <ErrorState compact description={problem.message} correlationId={problem.correlationId} onRetry={onRetry} />;
}

function StayRow({ stay }: { stay: EligibleStay }) {
  return (
    <li>
      <Card interactive className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-white shadow-glow">
            <BedDouble className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-bold text-slate-900">{stay.hotelName}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-600">
              <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
              {formatDate(stay.checkIn)} to {formatDate(stay.checkOut)} · booking {stay.bookingReference}
            </p>
          </div>
        </div>
        <ButtonLink to={writeReviewPath(stay.bookingId)} aria-label={`Write a review of ${stay.hotelName}`} size="sm">
          <PenLine className="size-4" aria-hidden="true" /> Write a review
        </ButtonLink>
      </Card>
    </li>
  );
}

function ReviewRow({ review }: { review: MyReview }) {
  const info = reviewStatusInfo[review.status] ?? reviewStatusInfo.PENDING;
  return (
    <li>
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {review.hotelName && (
              <p className="text-sm text-slate-600">
                {review.hotelSlug
                  ? <Link to={`/hotels/${review.hotelSlug}`} className="rounded-sm font-semibold text-brand-700 hover:underline">{review.hotelName}</Link>
                  : review.hotelName}
                {review.bookingReference ? ` · booking ${review.bookingReference}` : ''}
              </p>
            )}
            <h4 className="mt-0.5 break-words text-base font-bold text-slate-900">{review.title}</h4>
          </div>
          <Badge tone={info.tone} dot>{info.label}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <StarScore rating={review.rating} />
          <span>Written {formatDate(review.createdAt)}</span>
        </div>
        <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">{review.text}</p>
        {review.status === 'REJECTED' ? (
          <Alert tone="warning" title="Why it was not published">
            {review.rejectionReason || info.description}
          </Alert>
        ) : (
          <p className="border-t border-slate-100 pt-3 text-xs text-slate-600">{info.description}</p>
        )}
      </Card>
    </li>
  );
}
