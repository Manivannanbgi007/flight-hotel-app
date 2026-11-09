import { useRef, useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Flag, Star } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { ExportMenu } from '@/components/export/ExportMenu';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { EmptyState } from '@/components/ui/StateViews';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDateTime } from '@/lib/format';
import { ListLoading, LoadError, PageHeader, ProblemAlert, RequirePermission, ResultCount, SearchBox } from '../shared/adminUi';
import { readEnum, readPage, useSearchState } from '../shared/searchState';
import { reviewModerationApi, type ModerationReview, type ReviewFilters, type ReviewQueue } from './reviewModerationApi';

const TABS: { value: ReviewQueue; label: string; empty: string }[] = [
  { value: 'PENDING', label: 'Pending', empty: 'No reviews wait for a decision.' },
  { value: 'REPORTED', label: 'Reported', empty: 'No open reports.' },
  { value: 'APPROVED', label: 'Approved', empty: 'No approved reviews.' },
  { value: 'REJECTED', label: 'Rejected', empty: 'No rejected reviews.' },
];
const QUEUES = TABS.map((tab) => tab.value);

const STATUS_BADGE = {
  PENDING: { label: 'Pending', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
} as const;

/** The columns of an export (CSV, Excel, PDF): what each review card shows, one fact per column. */
const EXPORT_COLUMNS: ExportColumn<ModerationReview>[] = [
  { header: 'Hotel', value: (review) => review.hotelName },
  { header: 'Author', value: (review) => review.authorName },
  { header: 'Rating', value: (review) => review.rating, type: 'integer' },
  { header: 'Title', value: (review) => review.title },
  { header: 'Review', value: (review) => review.text, width: 60 },
  { header: 'Status', value: (review) => STATUS_BADGE[review.status]?.label ?? review.status },
  { header: 'Reports', value: (review) => review.reportCount, type: 'integer' },
  { header: 'Report reasons', value: (review) => review.reports.map((report) => report.reason).join(' | '), width: 40 },
  { header: 'Rejection reason', value: (review) => review.rejectionReason },
  { header: 'Stayed', value: (review) => review.stayedIn },
  { header: 'Booking reference', value: (review) => review.bookingReference },
  { header: 'Written', value: (review) => review.createdAt, type: 'datetime' },
];

const rejectSchema = z.object({
  reason: z.string().trim().min(5, 'Write the reason (at least 5 characters)').max(300, 'Use at most 300 characters'),
});
type RejectForm = z.infer<typeof rejectSchema>;

/** /admin/reviews — the moderation queue: approve or reject new reviews and handle reports. */
export function AdminReviewsPage() {
  return (
    <RequirePermission permission="REVIEW_MODERATE">
      <Reviews />
    </RequirePermission>
  );
}

function Reviews() {
  const { params, update } = useSearchState();
  const filters: ReviewFilters = { queue: readEnum(params, 'tab', QUEUES) || 'PENDING', q: params.get('q')?.trim() ?? '', page: readPage(params) };
  const size = readPageSize(params, PAGE_SIZES, 25);
  const reviews = useQuery({
    queryKey: [...queryKeys.admin.reviewList(filters), size],
    queryFn: () => reviewModerationApi.list(filters, size),
    placeholderData: keepPreviousData,
  });
  const data = reviews.data;
  const tab = TABS.find((entry) => entry.value === filters.queue)!;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (queue: ReviewQueue) => update({ tab: queue === 'PENDING' ? null : queue });
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + TABS.length) % TABS.length;
    tabRefs.current[next]?.focus();
    select(TABS[next]!.value);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={<Star className="size-5" />} title="Reviews" description="New reviews are shown on the hotel page once approved. Reports from guests land in Reported." actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>} />
      <div role="tablist" aria-label="Moderation queue" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((entry, index) => {
          const selected = entry.value === filters.queue;
          return (
            <button
              key={entry.value}
              ref={(element) => { tabRefs.current[index] = element; }}
              type="button"
              role="tab"
              id={`reviews-tab-${entry.value}`}
              aria-selected={selected}
              aria-controls="reviews-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(entry.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn('whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium',
                selected ? 'border-role-600 text-role-700' : 'border-transparent text-slate-600 hover:text-slate-900')}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
      <div id="reviews-panel" role="tabpanel" aria-labelledby={`reviews-tab-${filters.queue}`} className="flex flex-col gap-4">
        <SearchBox key={filters.q} initial={filters.q} label="Search" placeholder="Hotel, title or author" onSearch={(q) => update({ q })} />
        {reviews.isPending && <ListLoading label="Loading reviews…" />}
        {reviews.isError && <LoadError error={reviews.error} onRetry={() => void reviews.refetch()} />}
        {data && data.content.length === 0 && <EmptyState title={tab.empty} />}
        {data && data.content.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ResultCount count={data.totalElements} noun={['review', 'reviews']} />
              <ExportMenu
                className="ml-auto"
                title="Reviews"
                subtitle="Admin portal"
                fileName={`reviews-${tab.label}`}
                columns={EXPORT_COLUMNS}
                rows={data.content}
                total={data.totalElements}
                pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
                fetchPage={(page, pageSize) => reviewModerationApi.list({ ...filters, page }, pageSize)}
                rowKey={(review) => review.id}
                filters={describeFilters([['Queue', tab.label], ['Search', filters.q]])}
                personalData
              />
            </div>
            <ul className="flex flex-col gap-3" aria-label={`${tab.label} reviews`}>
              {data.content.map((review) => <li key={review.id}><ReviewCard review={review} /></li>)}
            </ul>
            <Pagination data={data} noun={['review', 'reviews']} pageSizes={PAGE_SIZES} sizeLabel="Per page"
              onPageChange={(page) => update({ page: String(page) })} onPageSizeChange={(next) => update({ size: next === 25 ? null : String(next) })} />
          </>
        )}
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: ModerationReview }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.reviews });
    void queryClient.invalidateQueries({ queryKey: queryKeys.reviews.all });
  };
  const approve = useMutation({
    mutationFn: () => reviewModerationApi.approve(review.id),
    onSuccess: () => {
      refresh();
      toast.success(review.reportCount > 0 && review.status === 'APPROVED' ? 'Reports cleared: the review stays visible.' : 'Review approved.');
    },
  });
  const badge = STATUS_BADGE[review.status];
  const openReports = review.reports.length > 0;

  return (
    <Card className="p-4 sm:p-5">
      <article aria-label={`Review by ${review.authorName}: ${review.title}`} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-0.5" aria-label={`${review.rating} out of 5 stars`} role="img">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star key={star} aria-hidden="true" className={cn('size-4', star <= review.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
            ))}
          </span>
          <h2 className="font-bold text-slate-900">{review.title}</h2>
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {review.reportCount > 0 && <Badge tone="danger"><Flag className="size-3" aria-hidden="true" /> {review.reportCount} report{review.reportCount === 1 ? '' : 's'}</Badge>}
        </div>
        <p className="text-sm text-slate-600">
          {review.authorName} · {review.hotelName}{review.stayedIn ? ` · stayed ${review.stayedIn}` : ''}
          {review.bookingReference ? ` · ${review.bookingReference}` : ''} · {formatDateTime(review.createdAt)}
        </p>
        <p className="whitespace-pre-line text-sm text-slate-800">{review.text}</p>
        {review.rejectionReason && <p className="text-sm text-danger-600">Rejected: {review.rejectionReason}</p>}
        {openReports && (
          <section aria-label="Reports" className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2">
            <h3 className="text-sm font-semibold text-slate-900">Reports</h3>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {review.reports.map((report, index) => (
                <li key={`${report.createdAt}-${index}`} className="text-slate-800">
                  “{report.reason}” <span className="text-xs text-slate-500">{formatDateTime(report.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {(review.status !== 'APPROVED' || openReports) && (
            <Button size="sm" variant="role" loading={approve.isPending} onClick={() => approve.mutate()}>
              {review.status === 'APPROVED' ? 'Keep and clear reports' : 'Approve'}
            </Button>
          )}
          {review.status !== 'REJECTED' && <Button size="sm" variant="danger" onClick={() => setRejecting(true)}>Reject</Button>}
        </div>
        {approve.isError && <ProblemAlert error={approve.error} title="The review was not approved" />}
      </article>
      <RejectDialog review={review} open={rejecting} onClose={() => setRejecting(false)} onDone={refresh} />
    </Card>
  );
}

function RejectDialog({ review, open, onClose, onDone }: { review: ModerationReview; open: boolean; onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<RejectForm>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: '' },
  });
  const reject = useMutation({
    mutationFn: (reason: string) => reviewModerationApi.reject(review.id, reason),
    onSuccess: () => {
      onDone();
      toast.success('Review rejected.');
      reset();
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Reject this review?"
      description={review.status === 'APPROVED' ? 'It disappears from the hotel page and the rating is updated.' : 'It is not shown on the hotel page.'}>
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit((form) => reject.mutate(form.reason))(event)}>
        <TextAreaField label="Reason" rows={3} maxLength={300} hint="The author sees this reason." error={errors.reason?.message} {...register('reason')} />
        {reject.isError && <ProblemAlert error={reject.error} title="The review was not rejected" />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="danger" loading={reject.isPending}>Reject review</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
