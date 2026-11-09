import { useId, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { LostIllustration, StormIllustration } from '@/components/illustrations';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CheckboxField } from '@/components/ui/Field';
import { controlClass, radioClass } from '@/components/ui/fieldStyles';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime, formatMoney } from '@/lib/format';
import { bookingApi } from './bookingApi';
import { Art } from './BookingUi';
import { newIdempotencyKey } from './bookingDraft';
import {
  amountOf,
  customerReasons,
  customerReasonSchema,
  notCancellableText,
  notCancellableTitle,
  OTHER_REASON,
  REASON_MAX_LENGTH,
  reasonOf,
  staffReasons,
  staffReasonSchema,
  type CancelReasonForm,
} from './cancellation';
import type { BookingDetails, CancelBookingBody, Cancellation, CancellationQuote } from './types';

interface CancelBookingFormProps {
  booking: BookingDetails;
  /** `staff`: a support agent or admin cancels for the customer, so a reason is required. */
  mode?: 'customer' | 'staff';
  /** Staff with REFUND_MANAGE may waive the fee (full refund). */
  canWaiveFee?: boolean;
  /** Called after the `202`: the hotel or airline answers later. */
  onCancelled: (cancellation: Cancellation) => void;
  /** "Keep my booking" link or "Close" button next to the confirm button. */
  secondaryAction?: ReactNode;
}

/**
 * The cancellation quote (what is kept, what comes back, until when) and the confirmation. Every amount comes from
 * the server; the refund the user saw is sent back as `expectedRefundAmount`, so a changed figure is never applied
 * without asking again. One Idempotency-Key per request body: a retry of the same request (network error) reuses it.
 */
export function CancelBookingForm({ booking, mode = 'customer', canWaiveFee = false, onCancelled, secondaryAction }: CancelBookingFormProps) {
  const staff = mode === 'staff';
  const queryClient = useQueryClient();
  const [waiveFee, setWaiveFee] = useState(false);
  const waived = staff && canWaiveFee && waiveFee;
  const quoteKey = queryKeys.bookings.cancellationQuote(booking.id, waived);
  const quote = useQuery({
    queryKey: quoteKey,
    queryFn: () => bookingApi.cancellationQuote(booking.id, waived),
    // Deadlines pass while the page is open: always ask again instead of using a cached quote.
    staleTime: 0,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const data = quote.data;

  // "I understand" counts only for the figures that were on screen when it was ticked.
  const figures = data ? `${data.refundAmount}|${data.cancellationFee}|${data.feeWaived}` : '';
  const [acceptedFor, setAcceptedFor] = useState<string | null>(null);
  const accepted = acceptedFor !== null && acceptedFor === figures;

  const { register, handleSubmit, control, setError, formState: { errors } } = useForm<CancelReasonForm>({
    resolver: zodResolver(staff ? staffReasonSchema : customerReasonSchema),
    defaultValues: { choice: '', other: '' },
  });
  const choice = useWatch({ control, name: 'choice' });

  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const cancel = useMutation({
    mutationFn: (body: CancelBookingBody) => {
      const signature = JSON.stringify(body);
      if (keyRef.current?.body !== signature) {
        keyRef.current = { key: newIdempotencyKey(), body: signature };
      }
      return bookingApi.cancel(booking.id, body, keyRef.current.key);
    },
    onSuccess: (cancellation) => {
      // The 202 means the booking is now CANCELLATION_PENDING; show that at once, then load the real thing.
      queryClient.setQueryData<BookingDetails>(queryKeys.bookings.detail(booking.id), (old) =>
        old && old.status === 'CONFIRMED' && cancellation.status === 'PENDING'
          ? { ...old, status: 'CANCELLATION_PENDING', canCancel: false, cancellation }
          : old);
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.support.bookings });
      onCancelled(cancellation);
    },
    onError: (error) => {
      const problem = ApiError.from(error);
      if (problem.code === 'CANCELLATION_QUOTE_CHANGED') {
        // New figures = a new request body, so the next confirmation gets a new key.
        keyRef.current = null;
        const refundAmount = amountOf(problem.details.refundAmount);
        const cancellationFee = amountOf(problem.details.cancellationFee);
        queryClient.setQueryData<CancellationQuote>(quoteKey, (old) => old && {
          ...old,
          refundAmount: refundAmount ?? old.refundAmount,
          cancellationFee: cancellationFee ?? old.cancellationFee,
          freeCancellation: (cancellationFee ?? old.cancellationFee) === 0,
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.cancellationQuotes(booking.id) });
      } else if (problem.code === 'BOOKING_NOT_CANCELLABLE') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(booking.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.cancellationQuotes(booking.id) });
      } else if (problem.code === 'REASON_REQUIRED') {
        setError('choice', { type: 'server', message: problem.message }, { shouldFocus: true });
      }
    },
  });

  const submit = handleSubmit((form) => {
    if (!data || !accepted) {
      return;
    }
    const reason = reasonOf(form);
    cancel.mutate({
      ...(reason ? { reason } : {}),
      expectedRefundAmount: data.refundAmount,
      ...(waived ? { waiveFee: true } : {}),
    });
  });

  const reasons: readonly string[] = staff ? staffReasons : customerReasons;
  const problem = cancel.error ? ApiError.from(cancel.error) : null;
  const otherId = useId();
  const choiceErrorId = useId();
  const otherHintId = useId();

  return (
    <div className="flex flex-col gap-4">
      {quote.isPending && (
        <>
          <span role="status" className="sr-only">Working out your refund…</span>
          <Skeleton className="h-64 w-full rounded-2xl" />
        </>
      )}
      {quote.isError && <QuoteError error={ApiError.from(quote.error)} onRetry={() => void quote.refetch()} />}
      {data && !data.cancellable && (
        <Alert tone={data.reasonCode === 'CANCELLATION_IN_PROGRESS' ? 'info' : 'warning'} title={notCancellableTitle(data.reasonCode)}>
          {data.message ?? notCancellableText(data.reasonCode, booking.type)}
        </Alert>
      )}
      {data?.cancellable && <QuoteFigures quote={data} staff={staff} updating={quote.isPlaceholderData} />}

      {staff && canWaiveFee && (data?.cancellable || waived) && (
        <CheckboxField
          checked={waiveFee}
          onChange={(event) => setWaiveFee(event.target.checked)}
          label="Waive the cancellation fee (full refund). Use it when the hotel or airline cancelled, or as goodwill."
        />
      )}

      {data?.cancellable && (
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2" aria-describedby={errors.choice ? choiceErrorId : undefined}>
            <legend className="mb-2 text-sm font-semibold text-slate-900">
              {staff ? 'Reason' : 'Why are you cancelling?'}
              {!staff && <span className="font-normal text-slate-500"> (optional)</span>}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[...reasons, OTHER_REASON].map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-medium text-slate-800 shadow-xs transition-colors duration-(--duration-fast) hover:border-slate-300 has-[:checked]:border-role-500 has-[:checked]:bg-role-50"
                >
                  <input type="radio" value={value} className={radioClass} {...register('choice')} />
                  {value === OTHER_REASON ? 'Other' : value}
                </label>
              ))}
            </div>
            {errors.choice && <p id={choiceErrorId} className="text-sm font-medium text-danger-700">{errors.choice.message}</p>}
          </fieldset>
          {choice === OTHER_REASON && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={otherId} className="text-sm font-semibold text-slate-800">{staff ? 'Write the reason' : 'Tell us more'}</label>
              <textarea
                id={otherId}
                rows={3}
                maxLength={REASON_MAX_LENGTH}
                aria-invalid={errors.other ? true : undefined}
                aria-describedby={otherHintId}
                className={controlClass(Boolean(errors.other))}
                {...register('other')}
              />
              <p id={otherHintId} className={errors.other ? 'text-sm font-medium text-danger-700' : 'text-xs text-slate-500'}>
                {errors.other?.message ?? `Up to ${REASON_MAX_LENGTH} characters.`}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <CheckboxField
              checked={accepted}
              onChange={(event) => setAcceptedFor(event.target.checked ? figures : null)}
              label={understandLabel(data, staff)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="danger" disabled={!accepted || quote.isPlaceholderData} loading={cancel.isPending}>
              {staff ? 'Cancel for the customer' : 'Confirm cancellation'}
            </Button>
            {secondaryAction}
          </div>
          {problem && <SubmitProblem problem={problem} currency={data.currency} type={booking.type} />}
        </form>
      )}
    </div>
  );
}

function understandLabel(quote: CancellationQuote, staff: boolean): string {
  if (staff) {
    return 'I understand that this cancels the booking for the customer and cannot be undone.';
  }
  return quote.refundAmount > 0
    ? `I understand that cancelling cannot be undone and that ${formatMoney(quote.refundAmount, quote.currency, true)} will be refunded.`
    : 'I understand that cancelling cannot be undone and that nothing will be refunded.';
}

function QuoteError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <ErrorState
      illustration={<Art size="sm">{error.status === 404 ? <LostIllustration /> : <StormIllustration />}</Art>}
      title={error.status === 404 ? 'Booking not found' : 'We could not work out the refund'}
      description={error.message}
      correlationId={error.correlationId}
      onRetry={error.status === 404 ? undefined : onRetry}
    />
  );
}

/** Paid, fee, refund, the deadlines and the policy, as the server calculated them. */
function QuoteFigures({ quote, staff, updating }: { quote: CancellationQuote; staff: boolean; updating: boolean }) {
  const money = (amount: number) => formatMoney(amount, quote.currency, true);
  return (
    <Card className="overflow-hidden">
      <section aria-label="Refund calculation" aria-busy={updating || undefined}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-gradient-sky px-5 py-4 sm:px-6">
          <h2 className="text-base font-bold tracking-tight text-slate-900">{staff ? 'Refund for the customer' : 'What you get back'}</h2>
          {updating && <span role="status" className="text-xs font-medium text-slate-600">Updating…</span>}
        </div>
        <div className="px-5 py-5 sm:px-6">
          <dl className="flex flex-col gap-2.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Paid</dt>
              <dd className="tabular-nums text-slate-800">{money(quote.paidAmount)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">
                Cancellation fee
                {quote.feeDescription && !quote.feeWaived && <span className="block text-xs text-slate-500">{quote.feeDescription}</span>}
              </dt>
              <dd className="shrink-0 tabular-nums text-slate-800">{quote.feeWaived ? 'Waived' : money(quote.cancellationFee)}</dd>
            </div>
            <div className={`mt-1 flex items-baseline justify-between gap-3 rounded-xl px-3 py-3 text-base font-bold text-slate-900 ring-1 ring-inset ${quote.refundAmount > 0 ? 'bg-success-50 ring-success-200' : 'bg-slate-50 ring-slate-200'}`}>
              <dt>Refund</dt>
              <dd className="text-lg tabular-nums">{money(quote.refundAmount)}</dd>
            </div>
          </dl>
          <ul className="mt-4 flex flex-col gap-1 text-sm text-slate-700">
            {quote.freeCancellationUntil && (
              <li>
                {quote.freeCancellation ? 'Free cancellation until ' : 'Free cancellation ended on '}
                <strong>{formatDateTime(quote.freeCancellationUntil)}</strong>.
              </li>
            )}
            {quote.cancelUntil && <li>Can be cancelled until <strong>{formatDateTime(quote.cancelUntil)}</strong>.</li>}
          </ul>
          {(quote.freeCancellationUntil || quote.cancelUntil) && <p className="mt-1 text-xs text-slate-500">Times are shown in your time zone.</p>}
          {quote.policy && (
            <p className="mt-3 text-sm text-slate-600"><span className="font-semibold text-slate-800">Cancellation policy: </span>{quote.policy}</p>
          )}
          {quote.refundAmount === 0 && (
            <Alert tone="warning" className="mt-4" title="Non-refundable: nothing will be refunded">
              {staff
                ? 'Under the cancellation rules the customer gets nothing back.'
                : `Under the cancellation rules you get nothing back if you cancel now. You lose the ${money(quote.paidAmount)} you paid.`}
            </Alert>
          )}
        </div>
      </section>
    </Card>
  );
}

function SubmitProblem({ problem, currency, type }: { problem: ApiError; currency: string; type: 'HOTEL' | 'FLIGHT' }) {
  if (problem.code === 'REASON_REQUIRED') {
    return null; // shown next to the reason
  }
  if (problem.code === 'CANCELLATION_QUOTE_CHANGED') {
    const refundAmount = amountOf(problem.details.refundAmount);
    const cancellationFee = amountOf(problem.details.cancellationFee);
    return (
      <Alert tone="warning" title="The refund has changed">
        {refundAmount !== null && (
          <p>
            New refund: <strong>{formatMoney(refundAmount, currency, true)}</strong>
            {cancellationFee !== null && <> (cancellation fee {formatMoney(cancellationFee, currency, true)})</>}.
          </p>
        )}
        <p>Please check the amounts above and confirm again.</p>
      </Alert>
    );
  }
  if (problem.code === 'BOOKING_NOT_CANCELLABLE') {
    return (
      <Alert tone="danger" title={notCancellableTitle(problem.details.reasonCode)}>
        {problem.message || notCancellableText(problem.details.reasonCode, type)}
        {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
      </Alert>
    );
  }
  return (
    <Alert tone="danger" title="We could not cancel the booking">
      {problem.message}
      {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
    </Alert>
  );
}
