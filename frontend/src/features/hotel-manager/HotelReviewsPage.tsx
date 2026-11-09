import { useId } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';
import { Clock3, MessageSquare, Star } from 'lucide-react';

import { BarChart, ChartCard, formatCount, formatPercent, LineChart, seriesColor } from '@/components/charts';
import { ExportMenu } from '@/components/export/ExportMenu';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { selectClass } from '@/components/ui/fieldStyles';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/StateViews';
import { ListLoading } from '@/features/admin/shared/adminUi';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDate } from '@/lib/format';
import { FilterPills, HotelPageError, ManagerPageHeader, RatingStars, Toolbar, type PillOption } from './ManagerParts';
import { operationsApi } from './operationsApi';
import type { ManagerReview, ReviewSortKey, ReviewStatus, ReviewSummary } from './operationsTypes';
import { REVIEW_STATUSES, reviewStatusInfo } from './reservationStatus';
import { useManagerHotels } from './useManagerHotels';

/** Reviews per page unless `?size=` asks for another of `PAGE_SIZES` (the API allows up to 100). */
const DEFAULT_PAGE_SIZE = 10;
const SORT_LABELS: Record<ReviewSortKey, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  highest: 'Highest rated first',
  lowest: 'Lowest rated first',
};
const SORTS = Object.keys(SORT_LABELS) as ReviewSortKey[];
const STATUS_DOTS: Record<ReviewStatus, string> = { PENDING: 'bg-warning-500', APPROVED: 'bg-success-500', REJECTED: 'bg-danger-500' };
const rating = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const share = (part: number, total: number) => (total === 0 ? 0 : (part / total) * 100);
const plural = (count: number, one: string, many: string) => `${formatCount(count)} ${count === 1 ? one : many}`;
const LIST_ID = 'review-list';

/** The columns of an export (CSV, Excel, PDF): what each review card shows. */
const EXPORT_COLUMNS: ExportColumn<ManagerReview>[] = [
  { header: 'Rating', value: (review) => review.rating, type: 'integer' },
  { header: 'Title', value: (review) => review.title, width: 32 },
  { header: 'Review', value: (review) => review.text, width: 60 },
  { header: 'Author', value: (review) => review.authorName ?? 'Guest' },
  { header: 'Stayed in', value: (review) => review.stayedIn },
  { header: 'Booking reference', value: (review) => review.bookingReference },
  { header: 'Written on', value: (review) => review.createdAt, type: 'date' },
  { header: 'Status', value: (review) => reviewStatusInfo[review.status]?.label ?? review.status },
  { header: 'Reason for rejection', value: (review) => (review.status === 'REJECTED' ? review.rejectionReason : null), width: 40 },
];

/** Brings the list into view after a filter set above it (the rating rows, "Show them"). */
function showList() {
  document.getElementById(LIST_ID)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

/**
 * /hotel-manager/hotels/:hotelId/reviews — what guests wrote about the hotel, in every moderation status: the rating
 * overview of the approved reviews (average, figures, stars per rating; a star row filters the list), the monthly
 * charts, then the reviews with status pills, rating and sorting, all in the URL. Read only: administrators approve or
 * reject reviews, and the hotel cannot answer them yet. Live: `review.changed`.
 */
export function HotelReviewsPage() {
  const { hotelId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status') as ReviewStatus | null;
  const status = statusParam && REVIEW_STATUSES.includes(statusParam) ? statusParam : '';
  const stars = Number(params.get('rating'));
  const ratingFilter = Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : null;
  const sortParam = params.get('sort') as ReviewSortKey | null;
  const sort = sortParam && SORTS.includes(sortParam) ? sortParam : 'newest';
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const size = readPageSize(params, PAGE_SIZES, DEFAULT_PAGE_SIZE);
  const reviews = useQuery({
    queryKey: queryKeys.hotelManager.reviewList(hotelId, { status, rating: ratingFilter, sort, page, size }),
    queryFn: () => operationsApi.reviews(hotelId, { status, page, rating: ratingFilter, sort }, size),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: queryKeys.hotelManager.reviewSummary(hotelId),
    queryFn: () => operationsApi.reviewSummary(hotelId),
  });

  /** A new filter, sort or page size starts again on page 1. */
  const update = (changes: { status?: string; rating?: string; sort?: string; page?: number; size?: number }) => {
    const next = new URLSearchParams(params);
    const set = (name: string, value: string | undefined, fallback = '') => {
      if (value && value !== fallback) next.set(name, value);
      else next.delete(name);
      next.delete('page');
    };
    if (changes.status !== undefined) set('status', changes.status);
    if (changes.rating !== undefined) set('rating', changes.rating);
    if (changes.sort !== undefined) set('sort', changes.sort, 'newest');
    if (changes.size !== undefined) set('size', String(changes.size), String(DEFAULT_PAGE_SIZE));
    if (changes.page !== undefined) next.set('page', String(changes.page));
    setParams(next);
  };

  const hotelName = useManagerHotels().data?.find((hotel) => hotel.id === hotelId)?.name;
  const data = reviews.data;
  const filtered = status !== '' || ratingFilter !== null;
  const counts: Partial<Record<ReviewStatus, number | null>> = {
    APPROVED: summary.data ? summary.data.total : summary.isPending ? null : undefined,
    PENDING: summary.data ? summary.data.pending : summary.isPending ? null : undefined,
  };
  const statusPills: PillOption<ReviewStatus | ''>[] = [
    { value: '', label: 'All' },
    ...REVIEW_STATUSES.map((value) => ({ value, label: reviewStatusInfo[value].label, dot: STATUS_DOTS[value], count: counts[value] })),
  ];
  return (
    <div className="flex flex-col gap-5">
      <ManagerPageHeader
        icon={<MessageSquare className="size-5" />}
        title="Guest reviews"
        description="Guests review their stay after check-out. Our team checks every review before it is published."
        actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>}
      />

      <ReviewOverview
        summary={summary.data}
        loading={summary.isPending}
        failed={summary.isError}
        ratingFilter={ratingFilter}
        onRating={(value) => { update({ rating: value === ratingFilter ? '' : String(value) }); showList(); }}
        onPending={() => { update({ status: 'PENDING' }); showList(); }}
      />
      <ReviewCharts summary={summary.data} loading={summary.isPending} failed={summary.isError} />

      <section id={LIST_ID} aria-labelledby="review-list-title" className="flex scroll-mt-24 flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 id="review-list-title" className="text-lg font-bold tracking-tight text-slate-900">All reviews</h3>
          {data && data.content.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="text-sm font-medium text-slate-500">{plural(data.totalElements, 'review', 'reviews')}</p>
              <ExportMenu
                title="Guest reviews"
                subtitle={hotelName}
                fileName={`reviews-${hotelName ?? hotelId}`}
                columns={EXPORT_COLUMNS}
                rows={data.content}
                total={data.totalElements}
                pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
                fetchPage={(next, pageSize) => operationsApi.reviews(hotelId, { status, page: next, rating: ratingFilter, sort }, pageSize)}
                rowKey={(review) => review.id}
                filters={describeFilters([
                  ['Status', status && reviewStatusInfo[status].label],
                  ['Rating', ratingFilter !== null && `${ratingFilter} star${ratingFilter === 1 ? '' : 's'}`],
                  ['Sort', SORT_LABELS[sort]],
                ])}
                personalData
              />
            </div>
          )}
        </div>
        <Toolbar>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FilterPills label="Reviews by status" options={statusPills} value={status} onChange={(value) => update({ status: value })} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                Rating
                <select value={ratingFilter === null ? '' : String(ratingFilter)} onChange={(event) => update({ rating: event.target.value })}
                  className={selectClass(false, { inline: true, size: 'sm' })}>
                  <option value="">Any rating</option>
                  {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} star{value === 1 ? '' : 's'}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                Sort by
                <select value={sort} onChange={(event) => update({ sort: event.target.value })} className={selectClass(false, { inline: true, size: 'sm' })}>
                  {SORTS.map((value) => <option key={value} value={value}>{SORT_LABELS[value]}</option>)}
                </select>
              </label>
            </div>
          </div>
        </Toolbar>

        {reviews.isPending && <ListLoading label="Loading reviews…" rows={3} />}
        {reviews.isError && <HotelPageError error={reviews.error} onRetry={() => void reviews.refetch()} />}
        {data && data.content.length === 0 && (
          <EmptyState
            illustration={filtered ? 'search' : 'inbox'}
            title={filtered ? 'No reviews match these filters' : 'No reviews yet'}
            description={filtered ? 'Try another status or rating.' : 'Reviews appear here once guests write about their stay.'}
          />
        )}
        {data && data.content.length > 0 && (
          <>
            <ul className="stagger flex flex-col gap-3" aria-label="Reviews">
              {data.content.map((review) => <ReviewItem key={review.id} review={review} />)}
            </ul>
            <Pagination
              data={data}
              onPageChange={(next) => update({ page: next })}
              onPageSizeChange={(next) => update({ size: next })}
              noun={['review', 'reviews']}
              sizeLabel="Per page"
            />
          </>
        )}
      </section>
    </div>
  );
}

/**
 * The approved reviews at a glance: the average and the figures (a labelled list) next to the stars per rating, each
 * row a toggle that filters the list by that rating. Hidden when the summary cannot be loaded.
 */
function ReviewOverview({ summary, loading, failed, ratingFilter, onRating, onPending }: {
  summary?: ReviewSummary;
  loading: boolean;
  failed: boolean;
  ratingFilter: number | null;
  onRating: (stars: number) => void;
  onPending: () => void;
}) {
  const overviewId = useId();
  const distributionId = useId();
  if (failed) return null;
  const total = summary?.total ?? 0;
  const ofAll = (part: number, words: string) => (summary && total > 0 ? `${formatPercent(share(part, total))} ${words}` : undefined);
  const pending = summary?.pending ?? 0;
  return (
    <div className="grid gap-4 animate-fade-up lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" aria-busy={loading || undefined}>
      <section aria-labelledby={overviewId} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
        <h3 id={overviewId} className="text-base font-semibold text-slate-900">Rating overview</h3>
        <p className="mt-0.5 text-sm text-slate-500">Published reviews only</p>
        <ul aria-label="Review figures" className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <li className="relative isolate col-span-2 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,var(--role-700)_0%,var(--role-900)_70%,var(--role-950)_100%)] p-4 text-white shadow-md">
            <span aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 -z-10 size-48 rounded-full bg-[radial-gradient(circle,rgb(255_255_255/0.16)_0%,transparent_65%)]" />
            <p className="text-sm font-medium text-white/90">Average rating</p>
            {loading ? (
              <>
                <span role="status" className="sr-only">Loading the average rating…</span>
                <Skeleton className="mt-2 h-10 w-28 bg-white/20" />
              </>
            ) : summary?.average == null ? (
              <p className="mt-1 text-2xl font-bold">No rating yet</p>
            ) : (
              <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
                <p className="text-4xl font-bold tracking-tight tabular-nums">
                  {rating.format(summary.average)}<span className="text-lg font-semibold text-white/75"> / 5</span>
                </p>
                <RatingStars rating={Math.round(summary.average)} className="mb-1.5" />
              </div>
            )}
          </li>
          <Figure label="Total reviews" value={summary?.total} loading={loading}
            note="Published on the hotel’s page" />
          <Figure label="Five-star reviews" value={summary?.fiveStar} loading={loading}
            note={ofAll(summary?.fiveStar ?? 0, 'of all reviews') ?? 'Reviews with 5 stars'} />
          <Figure label="Positive reviews" value={summary?.positive} loading={loading}
            note={ofAll(summary?.positive ?? 0, 'gave 4 or 5 stars') ?? '4 or 5 stars'} />
          <Figure label="Negative reviews" value={summary?.negative} loading={loading}
            note={ofAll(summary?.negative ?? 0, 'gave 1 or 2 stars') ?? '1 or 2 stars'} />
          <li className={cn('col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 ring-1 ring-inset sm:col-span-3',
            pending > 0 ? 'bg-warning-50 ring-warning-200' : 'bg-slate-50 ring-slate-200/70')}>
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-inset',
                pending > 0 ? 'text-warning-600 ring-warning-200' : 'text-slate-500 ring-slate-200')}>
                <Clock3 className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {loading ? <Skeleton className="inline-block h-4 w-6 align-middle" /> : formatCount(pending)}{' '}
                  <span>Waiting for moderation</span>
                </p>
                <p className="text-xs text-slate-600">An administrator has not checked these yet</p>
              </div>
            </div>
            {pending > 0 && <Button size="sm" variant="secondary" onClick={onPending}>Show them</Button>}
          </li>
        </ul>
      </section>

      <section aria-labelledby={distributionId} className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
        <h3 id={distributionId} className="text-base font-semibold text-slate-900">Rating distribution</h3>
        <p className="mt-0.5 text-sm text-slate-500">Published reviews per star rating. Choose a rating to list only those reviews.</p>
        <ul aria-label="Reviews per star rating" className="mt-4 flex flex-col gap-1">
          {[5, 4, 3, 2, 1].map((value) => {
            const count = summary?.distribution[String(value) as '1' | '2' | '3' | '4' | '5'] ?? 0;
            const percent = share(count, total);
            const pressed = ratingFilter === value;
            return (
              <li key={value}>
                <button
                  type="button"
                  aria-pressed={pressed}
                  aria-label={`${value} star${value === 1 ? '' : 's'}: ${plural(count, 'review', 'reviews')}, ${formatPercent(percent)}`}
                  onClick={() => onRating(value)}
                  className={cn(
                    'grid w-full grid-cols-[3.25rem_minmax(0,1fr)_6rem] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-(--duration-fast)',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-600',
                    pressed ? 'bg-role-50 ring-1 ring-inset ring-role-200' : 'hover:bg-slate-50',
                  )}
                >
                  <span aria-hidden="true" className="flex items-center gap-1 text-sm font-semibold text-slate-800">
                    {value}<Star className="size-4 fill-amber-400 text-amber-400" />
                  </span>
                  <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-amber-400 transition-[width] duration-(--duration-slow) ease-out-soft"
                      style={{ width: `${percent}%` }} />
                  </span>
                  <span aria-hidden="true" className="text-right text-sm tabular-nums text-slate-500">
                    {loading ? '–' : <><span className="font-semibold text-slate-900">{formatCount(count)}</span> · {formatPercent(percent)}</>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {ratingFilter !== null && (
          <p className="mt-2 px-3 text-xs text-slate-500">
            Showing {ratingFilter}-star reviews below. Choose the row again to show every rating.
          </p>
        )}
        {summary && total > 0 && <Sentiment summary={summary} />}
      </section>
    </div>
  );
}

/** Positive (4–5 stars), neutral (3 stars) and negative (1–2 stars) reviews as one bar, with the shares as text. */
function Sentiment({ summary }: { summary: ReviewSummary }) {
  const neutral = Math.max(summary.total - summary.positive - summary.negative, 0);
  const parts = [
    { label: 'Positive', count: summary.positive, bar: 'bg-success-500' },
    { label: 'Neutral', count: neutral, bar: 'bg-slate-300' },
    { label: 'Negative', count: summary.negative, bar: 'bg-danger-500' },
  ];
  return (
    <div className="mt-auto border-t border-slate-100 pt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">How guests feel</p>
      <div aria-hidden="true" className="mt-2.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100">
        {parts.filter((part) => part.count > 0).map((part) => (
          <span key={part.label} className={part.bar} style={{ width: `${share(part.count, summary.total)}%` }} />
        ))}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {parts.map((part) => (
          <span key={part.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('size-2 rounded-full', part.bar)} />
            {part.label} {formatPercent(share(part.count, summary.total))}
          </span>
        ))}
      </p>
    </div>
  );
}

/** One small figure of the overview: label, count and a note. */
function Figure({ label, value, note, loading }: { label: string; value?: number; note: string; loading: boolean }) {
  return (
    <li className="flex min-w-0 flex-col rounded-2xl bg-slate-50/80 p-4 ring-1 ring-inset ring-slate-200/70">
      <p className="min-w-0 text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
        {loading ? <Skeleton className="h-7 w-10" /> : formatCount(value ?? 0)}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{note}</p>
    </li>
  );
}

/** The last 12 months of approved reviews: the average per month and positive against negative reviews. */
function ReviewCharts({ summary, loading, failed }: { summary?: ReviewSummary; loading: boolean; failed: boolean }) {
  if (failed) return null;
  const months = (summary?.months ?? []).map((month) => ({ ...month, start: `${month.month}-01` }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard as="h3" title="Rating by month" description="Average rating of the reviews written in each of the last 12 months">
        <LineChart title="Rating by month" data={months} xKey="start" xFormat="month" valueFormat={(value) => rating.format(value)} loading={loading}
          series={[{ key: 'average', label: 'Average rating', color: seriesColor(3) }]} emptyMessage="No reviews in the last 12 months" />
      </ChartCard>
      <ChartCard as="h3" title="Reviews by month" description="Positive and negative reviews written in each month">
        <BarChart title="Reviews by month" data={months} xKey="start" xFormat="month" valueFormat="count" loading={loading} stacked
          series={[{ key: 'positive', label: 'Positive (4–5 stars)', color: seriesColor(1) }, { key: 'negative', label: 'Negative (1–2 stars)', color: seriesColor(4) }]}
          emptyMessage="No reviews in the last 12 months" />
      </ChartCard>
    </div>
  );
}

function ReviewItem({ review }: { review: ManagerReview }) {
  const info = reviewStatusInfo[review.status] ?? { label: review.status, tone: 'neutral' as const };
  const author = review.authorName ?? 'Guest';
  return (
    <li>
      <article className="flex gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card sm:p-5">
        <Avatar name={author} size="md" className="hidden sm:inline-flex" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{author}</p>
              <p className="text-xs text-slate-500">
                {[
                  review.stayedIn && `stayed in ${review.stayedIn}`,
                  review.bookingReference && `booking ${review.bookingReference}`,
                  `written ${formatDate(review.createdAt)}`,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <Badge tone={info.tone} dot>{info.label}</Badge>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <RatingStars rating={review.rating} />
            <span className="text-sm font-semibold tabular-nums text-slate-700">{rating.format(review.rating)}</span>
          </div>
          <h4 className="mt-1.5 break-words font-semibold text-slate-900">{review.title}</h4>
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">{review.text}</p>
          {review.status === 'REJECTED' && review.rejectionReason && (
            <p className="mt-3 rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700 ring-1 ring-inset ring-danger-100">
              <span className="font-semibold">Reason for rejection:</span> {review.rejectionReason}
            </p>
          )}
        </div>
      </article>
    </li>
  );
}
