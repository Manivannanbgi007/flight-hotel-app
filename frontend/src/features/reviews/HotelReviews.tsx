import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { Flag, MessageSquareQuote } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { Alert } from '@/components/ui/Alert';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Skeleton';
import { StarScore } from '@/components/ui/StarRatingInput';
import { EmptyState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { loginPath } from '@/lib/auth/redirects';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { reviewApi } from './reviewApi';
import { REPORT_MAX, reportSchema, REVIEW_SORTS, reviewSortLabels, type ReportForm } from './reviewText';
import type { PublicReview, ReviewSort, ReviewSummary } from './types';

export const HOTEL_REVIEWS_PAGE_SIZE = 5;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The hotel page's "Guest reviews": the summary (average, count, reviews per star) and the approved reviews, newest
 * first or by rating, a few per page. Logged-in visitors can report a review to the moderators.
 */
export function HotelReviews({ hotelIdOrSlug }: { hotelIdOrSlug: string }) {
  const [sort, setSort] = useState<ReviewSort>('RECENT');
  const [page, setPage] = useState(0);
  const reviews = useQuery({
    queryKey: queryKeys.reviews.hotelPage(hotelIdOrSlug, { sort, page }),
    queryFn: () => reviewApi.forHotel(hotelIdOrSlug, { page, size: HOTEL_REVIEWS_PAGE_SIZE, sort }),
    placeholderData: keepPreviousData,
  });
  const data = reviews.data;
  const loadError = reviews.isError ? ApiError.from(reviews.error) : null;
  const hasReviews = !!data && (data.summary.count > 0 || data.content.length > 0);

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="reviews-heading" className="text-lg font-bold tracking-tight text-slate-900">Guest reviews</h2>
          <p className="mt-0.5 text-sm text-slate-600">Written by guests after their stay and checked by our team.</p>
        </div>
        {hasReviews && (
          <div className="w-full sm:w-48">
            <SelectField label="Sort reviews" value={sort} onChange={(event) => { setSort(event.target.value as ReviewSort); setPage(0); }}>
              {REVIEW_SORTS.map((value) => <option key={value} value={value}>{reviewSortLabels[value]}</option>)}
            </SelectField>
          </div>
        )}
      </div>

      {reviews.isPending && (
        <div className="mt-4 grid gap-6 md:grid-cols-[14rem_1fr]" aria-hidden="true">
          <Skeleton className="h-48 rounded-2xl" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
          </div>
        </div>
      )}
      {loadError && (
        <Alert tone="danger" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Reviews could not be loaded.
              {loadError.correlationId && <span className="block text-xs">Support reference: {loadError.correlationId}</span>}
            </span>
            <Button variant="secondary" size="sm" onClick={() => void reviews.refetch()}>Try again</Button>
          </div>
        </Alert>
      )}
      {data && !hasReviews && (
        <EmptyState
          compact
          className="mt-4"
          illustration={(
            <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
              <MessageSquareQuote className="size-7" />
            </span>
          )}
          title="No written reviews yet"
          description="Guests can review their stay after check-out."
        />
      )}
      {hasReviews && data && (
        <div className="mt-4 grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
          <Summary summary={data.summary} />
          <div className="flex min-w-0 flex-col gap-3">
            <ul className={cn('flex flex-col gap-3 transition-opacity duration-(--duration-base)', reviews.isFetching && 'opacity-60')}
              aria-label="Reviews" aria-busy={reviews.isFetching || undefined}>
              {data.content.map((review) => <ReviewItem key={review.id} review={review} />)}
            </ul>
            <Pagination data={data} onPageChange={setPage} noun={['review', 'reviews']} />
          </div>
        </div>
      )}
    </section>
  );
}

function Summary({ summary }: { summary: ReviewSummary }) {
  return (
    <div className="flex h-fit flex-col gap-3 rounded-2xl border border-brand-100 bg-gradient-sky p-4" aria-label="Review summary" role="group">
      {summary.average !== null && (
        <div>
          <p className="text-4xl font-bold tracking-tight text-slate-900">{summary.average.toFixed(1)}<span className="text-base font-medium text-slate-600"> / 5</span></p>
          <StarScore rating={summary.average} size="md" className="mt-1" />
        </div>
      )}
      <p className="text-sm font-semibold text-slate-700">{plural(summary.count, 'review')}</p>
      <ul className="flex flex-col gap-1.5" aria-label="Reviews per rating">
        {[5, 4, 3, 2, 1].map((stars) => {
          const count = summary.distribution[String(stars)] ?? 0;
          const share = summary.count > 0 ? Math.round((count / summary.count) * 100) : 0;
          return (
            <li key={stars} className="grid grid-cols-[3.75rem_1fr_2rem] items-center gap-2 text-sm text-slate-700">
              <span>{plural(stars, 'star')}</span>
              <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-accent-100">
                <span className="block h-full rounded-full bg-accent-400 transition-[width] duration-(--duration-slow) ease-out-soft" style={{ width: `${share}%` }} />
              </span>
              <span className="text-right tabular-nums">{count}<span className="sr-only"> {count === 1 ? 'review' : 'reviews'}</span></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReviewItem({ review }: { review: PublicReview }) {
  const headingId = useId();
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
      <article aria-labelledby={headingId} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StarScore rating={review.rating} />
          <h3 id={headingId} className="min-w-0 break-words font-bold text-slate-900">{review.title}</h3>
        </div>
        <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">{review.text}</p>
        <div className="flex items-center gap-2">
          <Avatar name={review.authorName} size="xs" />
          <p className="text-xs text-slate-600">
            {review.authorName}{review.stayedIn ? ` · stayed in ${review.stayedIn}` : ''} · {formatDate(review.createdAt)}
          </p>
        </div>
      </article>
      <ReportReview review={review} />
    </li>
  );
}

/** "Report": a reason (5–300 characters) for the moderators. Visitors are asked to log in first. */
function ReportReview({ review }: { review: PublicReview }) {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const formId = useId();

  if (done) {
    return <p role="status" className="text-xs font-medium text-slate-600">{done}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="-ml-2">
        <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={formId} aria-label={`Report review: ${review.title}`}
          onClick={() => setOpen((value) => !value)} className="text-slate-600">
          <Flag className="size-3.5" aria-hidden="true" /> Report
        </Button>
      </div>
      {open && (
        <div id={formId} className="animate-slide-down">
          {user ? (
            <ReportForm review={review} onDone={setDone} onCancel={() => setOpen(false)} />
          ) : (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Please <Link to={loginPath(`${location.pathname}${location.search}`)} className="font-semibold text-brand-700 hover:underline">log in</Link> to report a review.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ReportForm({ review, onDone, onCancel }: { review: PublicReview; onDone: (message: string) => void; onCancel: () => void }) {
  const { register, handleSubmit, control, formState: { errors } } = useForm<ReportForm>({
    resolver: zodResolver(reportSchema),
    defaultValues: { reason: '' },
  });
  const reason = useWatch({ control, name: 'reason' });
  const report = useMutation({
    mutationFn: (form: ReportForm) => reviewApi.report(review.id, form.reason),
    onSuccess: () => onDone('Thank you. Our team will check this review.'),
    onError: (error) => {
      if (ApiError.from(error).code === 'ALREADY_REPORTED') onDone('You have already reported this review.');
    },
  });
  const problem = report.error ? ApiError.from(report.error) : null;

  return (
    <form noValidate aria-label="Report this review" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4"
      onSubmit={handleSubmit((form) => report.mutate(form))}>
      <TextAreaField
        label="Why are you reporting this review?"
        rows={3}
        maxLength={REPORT_MAX}
        hint={`${reason.length} / ${REPORT_MAX} characters`}
        error={errors.reason?.message}
        {...register('reason')}
      />
      {problem && problem.code !== 'ALREADY_REPORTED' && (
        <Alert tone="danger">
          {problem.code === 'OWN_REVIEW' ? 'You cannot report your own review.' : problem.message}
          {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={report.isPending}>Send report</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
