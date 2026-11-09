import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { BedDouble, CalendarDays, Lightbulb, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Alert } from '@/components/ui/Alert';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StarRatingInput } from '@/components/ui/StarRatingInput';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { SectionHeader } from '@/features/account/AccountLayout';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDate } from '@/lib/format';
import { reviewApi } from './reviewApi';
import { reviewSchema, TEXT_MAX, TEXT_MIN, TITLE_MAX, type ReviewForm } from './reviewText';
import type { EligibleStay } from './types';
import { useEligibleStays } from './useReviews';

const backLink = (
  <p className="mb-4 text-sm">
    <Link to="/account/reviews" className="rounded-md font-semibold text-brand-700 hover:underline">← My reviews</Link>
  </p>
);

/** What makes a review useful (guidance only). */
const TIPS = [
  'Say what you liked and what could be better.',
  'Mention the room, the staff, cleanliness and the location.',
  'Keep it about your own stay; leave out personal details.',
];

/** /account/reviews/write/:bookingId — rate a completed hotel stay (only stays from `GET /api/reviews/eligible`). */
export function WriteReviewPage() {
  const { bookingId = '' } = useParams();
  const eligible = useEligibleStays();

  if (eligible.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <span role="status" className="sr-only">Loading your stay…</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }
  if (eligible.isError) {
    const error = ApiError.from(eligible.error);
    return (
      <div>
        {backLink}
        <ErrorState description={error.message} correlationId={error.correlationId} onRetry={() => void eligible.refetch()} />
      </div>
    );
  }
  const stay = eligible.data.find((item) => item.bookingId === bookingId);
  if (!stay) {
    return (
      <div>
        {backLink}
        <EmptyState
          title="This stay cannot be reviewed"
          description="You can review a hotel stay once, after check-out. It may already have a review."
          action={<ButtonLink to="/account/reviews" variant="secondary">See my reviews</ButtonLink>}
        />
      </div>
    );
  }
  return <ReviewFormCard stay={stay} />;
}

function ReviewFormCard({ stay }: { stay: EligibleStay }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [shownOnField, setShownOnField] = useState(false);
  const { register, handleSubmit, control, setError, formState: { errors } } = useForm<ReviewForm>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { rating: 0, title: '', text: '' },
  });
  const [title, text] = useWatch({ control, name: ['title', 'text'] });

  const submit = useMutation({
    mutationFn: (form: ReviewForm) => reviewApi.create({ bookingId: stay.bookingId, ...form }),
    onMutate: () => setShownOnField(false),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reviews.all });
      toast.success('Thank you! Your review is waiting for approval.');
      void navigate('/account/reviews');
    },
    onError: (error) => {
      const problem = ApiError.from(error);
      if (problem.code === 'ALREADY_REVIEWED' || problem.code === 'NOT_ELIGIBLE') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.reviews.all });
      }
      setShownOnField(applyServerErrors(problem, setError, ['rating', 'title', 'text']));
    },
  });
  const problem = submit.error && !shownOnField ? ApiError.from(submit.error) : null;

  return (
    <div>
      {backLink}
      <SectionHeader
        title={`Review ${stay.hotelName}`}
        description={`Your stay from ${formatDate(stay.checkIn)} to ${formatDate(stay.checkOut)} · booking ${stay.bookingReference}`}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-gradient-sky px-5 py-4">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-white shadow-glow">
              <BedDouble className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-bold text-slate-900">{stay.hotelName}</p>
              <p className="flex items-center gap-1.5 text-xs text-slate-700">
                <CalendarDays className="size-3.5" aria-hidden="true" />
                {formatDate(stay.checkIn)} – {formatDate(stay.checkOut)}
              </p>
            </div>
          </div>
          <form aria-label="Write a review" noValidate className="flex flex-col gap-5 p-5 sm:p-6" onSubmit={handleSubmit((form) => submit.mutate(form))}>
            <Controller
              control={control}
              name="rating"
              render={({ field }) => (
                <StarRatingInput
                  ref={field.ref}
                  name={field.name}
                  label="Your rating"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.rating?.message}
                />
              )}
            />
            <TextField
              label="Title"
              maxLength={TITLE_MAX}
              placeholder="Sum up your stay"
              hint={`${title.length} / ${TITLE_MAX} characters`}
              error={errors.title?.message}
              {...register('title')}
            />
            <TextAreaField
              label="Your review"
              rows={6}
              maxLength={TEXT_MAX}
              placeholder="What did you like? What could be better?"
              hint={`${text.length} / ${TEXT_MAX} characters (at least ${TEXT_MIN})`}
              error={errors.text?.message}
              {...register('text')}
            />
            {problem && (
              <Alert tone="danger" title="Your review was not sent">
                {problem.code === 'ALREADY_REVIEWED' ? 'You have already reviewed this stay.' : problem.message}
                {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
              </Alert>
            )}
            <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
              We check every review before it is published. Your first name and the first letter of your last name are shown with it.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" size="lg" loading={submit.isPending}>Submit review</Button>
              <ButtonLink to="/account/reviews" variant="ghost" size="lg">Cancel</ButtonLink>
            </div>
          </form>
        </Card>

        <Card variant="tinted" className="h-fit p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Lightbulb className="size-4 text-accent-600" aria-hidden="true" /> Tips for a helpful review
          </h3>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-slate-700 marker:text-brand-600">
            {TIPS.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}
