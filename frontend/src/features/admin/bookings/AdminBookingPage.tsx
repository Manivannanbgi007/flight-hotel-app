import { useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useParams } from 'react-router';
import { AlertTriangle, BedDouble, Plane } from 'lucide-react';
import { toast } from 'sonner';

import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { LoadingState } from '@/components/ui/StateViews';
import { PaymentsCard, Timeline, TripSections } from '@/features/bookings/BookingDetailsPage';
import { BookingStatusBadge, PriceBreakdown } from '@/features/bookings/BookingParts';
import { newIdempotencyKey } from '@/features/bookings/bookingDraft';
import { CancelBookingForm } from '@/features/bookings/CancelBookingForm';
import { amountOf, canRetryRefund, latestRefund } from '@/features/bookings/cancellation';
import { CancellationCard } from '@/features/bookings/CancellationParts';
import { bookingPaymentStatusInfo } from '@/features/bookings/status';
import type { Attention, BookingDetails, SupportNote } from '@/features/bookings/types';
import { useBookingDetails } from '@/features/bookings/useBookingDetails';
import { DocumentsCard } from '@/features/documents/DocumentsCard';
import { DemoInventoryBadge } from '@/features/flights/FlightBadges';
import { DemoBadge } from '@/features/hotels/HotelBadges';
import {
  attentionLabel, escalateNoteSchema, resolveNoteSchema, supportNoteActionLabels, supportNoteAuthor, type NoteForm,
} from '@/features/support/attention';
import { supportApi } from '@/features/support/supportApi';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime, formatMoney } from '@/lib/format';
import { LoadError, ProblemAlert, RequirePermission } from '../shared/adminUi';
import { useCan } from '../shared/permissions';
import { adminBookingApi, type GoodwillRefundBody } from './adminBookingApi';
import { GOODWILL_REASON_MAX, goodwillSchema, refundableAmount, type GoodwillForm } from './goodwill';

/**
 * /admin/bookings/:bookingId — everything about one booking and the admin actions: cancel on behalf (fee can be
 * waived), retry a failed refund, goodwill refund, escalate / resolve, documents. Actions follow the permissions.
 */
export function AdminBookingPage() {
  return (
    <RequirePermission permission="BOOKING_READ_ANY">
      <BookingLoader />
    </RequirePermission>
  );
}

function BookingLoader() {
  const { bookingId = '' } = useParams();
  const booking = useBookingDetails(bookingId);
  if (booking.isPending) {
    return <LoadingState label="Loading the booking…" rows={4} />;
  }
  if (booking.isError) {
    const notFound = ApiError.from(booking.error).status === 404;
    return (
      <div className="flex flex-col items-center gap-4">
        <LoadError error={booking.error} title={notFound ? 'Booking not found' : undefined} onRetry={notFound ? undefined : () => void booking.refetch()} />
        <Link to="/admin/bookings" className="font-medium text-role-700 hover:underline">All bookings</Link>
      </div>
    );
  }
  return <AdminBooking booking={booking.data} />;
}

type Panel = 'cancel' | 'escalate' | 'resolve' | 'goodwill' | null;

function AdminBooking({ booking }: { booking: BookingDetails }) {
  const queryClient = useQueryClient();
  const manage = useCan('BOOKING_MANAGE_ANY');
  const manageRefunds = useCan('REFUND_MANAGE');
  const [panel, setPanel] = useState<Panel>(null);
  const canCancel = manage && (booking.canCancel || booking.status === 'CONFIRMED');
  const canResolve = manage && booking.attention !== null;
  const failedRefund = manageRefunds && canRetryRefund(booking) ? latestRefund(booking.refunds) : null;
  const refundable = refundableAmount(booking);
  const canGoodwill = manageRefunds && refundable > 0;
  const payment = bookingPaymentStatusInfo[booking.paymentStatus];
  const toggle = (next: Exclude<Panel, null>) => setPanel((current) => (current === next ? null : next));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(booking.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.timeline(booking.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.bookings });
    void queryClient.invalidateQueries({ queryKey: queryKeys.support.bookings });
  };
  const retry = useMutation({
    mutationFn: () => supportApi.retryRefund(booking.id),
    onSuccess: () => {
      toast.success('Refund requested again.');
      refresh();
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
    },
    onError: refresh,
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm"><Link to="/admin/bookings" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-semibold text-role-700 shadow-xs ring-1 ring-slate-200 transition-colors hover:bg-role-50">← Bookings</Link></p>
      <header className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card animate-fade-up">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-role-700">
          {booking.type === 'FLIGHT' ? <Plane className="size-3.5" aria-hidden="true" /> : <BedDouble className="size-3.5" aria-hidden="true" />}
          {booking.type === 'FLIGHT' ? 'Flight booking' : 'Hotel booking'}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{booking.reference}</h1>
          <BookingStatusBadge status={booking.status} type={booking.type} paymentStatus={booking.paymentStatus} />
          <Badge tone={payment.tone}>{payment.label}</Badge>
          {booking.demo && (booking.type === 'FLIGHT' ? <DemoInventoryBadge /> : <DemoBadge />)}
          <LiveIndicator className="ml-auto" />
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {booking.title ?? (booking.type === 'FLIGHT' ? 'Flight booking' : 'Hotel booking')} · booked {formatDateTime(booking.createdAt)}
        </p>
        <p className="mt-1 break-all text-sm text-slate-700">Customer contact: {booking.contactEmail} · {booking.contactPhone}</p>
        {(booking.failureMessage || booking.failureReason) && (
          <p className="mt-1 text-sm text-danger-600">Failure: {booking.failureMessage ?? booking.failureReason}</p>
        )}
      </header>

      {booking.attention && <AttentionPanel attention={booking.attention} />}
      {booking.supportNotes.length > 0 && <InternalNotes notes={booking.supportNotes} />}

      {(canCancel || manage || failedRefund || canGoodwill) && (
        <section aria-label="Actions" className="flex flex-wrap gap-2">
          {canCancel && <Button variant="danger" aria-expanded={panel === 'cancel'} onClick={() => toggle('cancel')}>Cancel on behalf</Button>}
          {canGoodwill && <Button variant="secondary" aria-expanded={panel === 'goodwill'} onClick={() => toggle('goodwill')}>Goodwill refund</Button>}
          {failedRefund && (
            <Button loading={retry.isPending} onClick={() => retry.mutate()}>
              Retry refund of {formatMoney(failedRefund.amount, failedRefund.currency, true)}
            </Button>
          )}
          {manage && <Button variant="secondary" aria-expanded={panel === 'escalate'} onClick={() => toggle('escalate')}>Escalate</Button>}
          {canResolve && <Button variant="secondary" aria-expanded={panel === 'resolve'} onClick={() => toggle('resolve')}>Mark resolved</Button>}
        </section>
      )}
      {retry.isError && <ProblemAlert error={retry.error} title="The refund was not requested again" />}

      {panel === 'cancel' && (
        <Card className="p-5">
          <h2 className="text-lg font-bold tracking-tight text-slate-900">Cancel on behalf of the customer</h2>
          <p className="mt-1 text-sm text-slate-600">
            The reason is shown to the customer and kept in the audit log. The booking is cancelled once the {booking.type === 'FLIGHT' ? 'airline' : 'hotel'} confirms.
          </p>
          <div className="mt-4">
            <CancelBookingForm
              booking={booking}
              mode="staff"
              canWaiveFee={manageRefunds}
              onCancelled={() => {
                toast.success('Cancellation requested for the customer.');
                setPanel(null);
              }}
              secondaryAction={<Button variant="ghost" onClick={() => setPanel(null)}>Close</Button>}
            />
          </div>
        </Card>
      )}
      {panel === 'goodwill' && <GoodwillPanel booking={booking} refundable={refundable} onClose={() => setPanel(null)} />}
      {(panel === 'escalate' || panel === 'resolve') && <NotePanel bookingId={booking.id} kind={panel} onClose={() => setPanel(null)} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <CancellationCard booking={booking} viewer="staff" />
          <TripSections booking={booking} />
          <PaymentsCard bookingId={booking.id} status={booking.status} />
          <DocumentsCard booking={booking} />
          <Timeline bookingId={booking.id} type={booking.type} />
        </div>
        <Card className="h-fit p-5">
          {booking.priceItems.length > 0
            ? <PriceBreakdown items={booking.priceItems} total={booking.totalAmount} currency={booking.currency} />
            : <p className="text-sm text-slate-600">No price yet: nothing was held.</p>}
          {booking.couponCode && <p className="mt-3 text-sm text-slate-600">Coupon <strong>{booking.couponCode}</strong></p>}
          {booking.couponNote && <p className="mt-1 text-sm text-slate-600">{booking.couponNote}</p>}
          {booking.refundedAmount > 0 && (
            <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-700">Refunded so far: <strong>{formatMoney(booking.refundedAmount, booking.currency, true)}</strong></p>
          )}
        </Card>
      </div>
    </div>
  );
}

function AttentionPanel({ attention }: { attention: Attention }) {
  return (
    <section aria-label="Needs attention" className="flex gap-3 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
      <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">Needs attention: {attentionLabel(attention.reason)}</p>
        <p>Since {formatDateTime(attention.since)}</p>
        {attention.note && <p className="mt-1">Note: {attention.note}</p>}
      </div>
    </section>
  );
}

/** Internal support history (never shown to the customer), oldest first. */
function InternalNotes({ notes }: { notes: SupportNote[] }) {
  const headingId = useId();
  return (
    <Card className="p-4">
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="text-sm font-semibold text-slate-900">Internal notes</h2>
        <ol className="mt-2 flex flex-col gap-2 text-sm">
          {notes.map((entry, index) => (
            <li key={`${entry.createdAt}-${index}`} className="border-l-2 border-slate-200 pl-3">
              <p className="font-medium text-slate-900">{supportNoteActionLabels[entry.action] ?? entry.action}</p>
              {entry.note && <p className="whitespace-pre-line text-slate-700">{entry.note}</p>}
              <p className="text-xs text-slate-500">{supportNoteAuthor(entry)} · {formatDateTime(entry.createdAt)}</p>
            </li>
          ))}
        </ol>
      </section>
    </Card>
  );
}

/**
 * Goodwill refund: amount (at most what is still refundable) and a reason, confirmed in a dialog. One Idempotency-Key
 * per submission; a retry of the same submission (network error) reuses it, so the money never goes out twice.
 */
function GoodwillPanel({ booking, refundable, onClose }: { booking: BookingDetails; refundable: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<GoodwillRefundBody | null>(null);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<GoodwillForm>({
    resolver: zodResolver(goodwillSchema(refundable, booking.currency)),
    defaultValues: { amount: '', reason: '' },
  });
  const refund = useMutation({
    mutationFn: (body: GoodwillRefundBody) => {
      const signature = JSON.stringify(body);
      if (keyRef.current?.body !== signature) {
        keyRef.current = { key: newIdempotencyKey(), body: signature };
      }
      return adminBookingApi.goodwillRefund(booking.id, body, keyRef.current.key);
    },
    onSuccess: (item) => {
      keyRef.current = null;
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(booking.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.timeline(booking.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
      toast.success(`Goodwill refund of ${formatMoney(item.amount, booking.currency, true)} requested.`);
      onClose();
    },
    onError: (error) => {
      setPending(null);
      const code = ApiError.from(error).code;
      if (code === 'REFUND_TOO_LARGE' || code === 'NOT_REFUNDABLE') {
        // The figures changed under us: a new attempt is a new submission.
        keyRef.current = null;
        void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(booking.id) });
      }
    },
  });

  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold tracking-tight text-slate-900">Goodwill refund</h2>
      <p className="mt-1 text-sm text-slate-600">
        Gives money back without cancelling: the booking keeps its status. At most {formatMoney(refundable, booking.currency, true)} can still be refunded.
      </p>
      <form noValidate className="mt-4 flex flex-col gap-4"
        onSubmit={(event) => void handleSubmit((form) => setPending({ amount: Number(form.amount), reason: form.reason.trim() }))(event)}>
        <TextField label={`Amount (${booking.currency})`} inputMode="decimal" autoComplete="off" error={errors.amount?.message} {...register('amount')} />
        <TextAreaField label="Reason" rows={3} maxLength={GOODWILL_REASON_MAX} hint="Kept with the refund and in the audit log."
          error={errors.reason?.message} {...register('reason')} />
        {refund.isError && <GoodwillProblem error={refund.error} currency={booking.currency} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={refund.isPending}>Continue</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </form>
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={`Refund ${formatMoney(pending?.amount ?? 0, booking.currency, true)}?`}
        description={`The money goes back to the payment method used for ${booking.reference}. This cannot be undone.`}
      >
        <div className="flex flex-wrap gap-2">
          <Button loading={refund.isPending} onClick={() => pending && refund.mutate(pending)}>Refund now</Button>
          <Button variant="ghost" onClick={() => setPending(null)}>Go back</Button>
        </div>
      </Dialog>
    </Card>
  );
}

/** `422 REFUND_TOO_LARGE` says how much is still refundable (`details.refundable`); everything else as sent. */
function GoodwillProblem({ error, currency }: { error: unknown; currency: string }) {
  const problem = ApiError.from(error);
  const refundable = amountOf(problem.details.refundable);
  if (problem.code === 'REFUND_TOO_LARGE' && refundable !== null) {
    return (
      <Alert tone="danger" title="The amount is too large">
        At most {formatMoney(refundable, currency, true)} can be refunded now.
        {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
      </Alert>
    );
  }
  return <ProblemAlert error={error} title="The refund was not requested" />;
}

const NOTE_TEXT = {
  escalate: {
    heading: 'Escalate this booking',
    help: 'The booking goes to the "Needs attention" queue. Notes are internal: the customer never sees them.',
    submit: 'Escalate booking',
    done: 'Escalated.',
  },
  resolve: {
    heading: 'Mark as resolved',
    help: 'The booking leaves the "Needs attention" queue. Notes are internal: the customer never sees them.',
    submit: 'Save and resolve',
    done: 'Marked as resolved.',
  },
} as const;

function NotePanel({ bookingId, kind, onClose }: { bookingId: string; kind: 'escalate' | 'resolve'; onClose: () => void }) {
  const queryClient = useQueryClient();
  const text = NOTE_TEXT[kind];
  const { register, handleSubmit, formState: { errors } } = useForm<NoteForm>({
    resolver: zodResolver(kind === 'escalate' ? escalateNoteSchema : resolveNoteSchema),
    defaultValues: { note: '' },
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(bookingId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.bookings });
    void queryClient.invalidateQueries({ queryKey: queryKeys.support.bookings });
  };
  const action = useMutation({
    mutationFn: async (note: string): Promise<Attention | null> => {
      if (kind === 'escalate') {
        return supportApi.escalate(bookingId, note);
      }
      await supportApi.resolve(bookingId, note || undefined);
      return null;
    },
    onSuccess: (attention) => {
      queryClient.setQueryData<BookingDetails>(queryKeys.bookings.detail(bookingId), (old) => old && { ...old, attention });
      refresh();
      toast.success(text.done);
      onClose();
    },
    onError: (error) => {
      if (ApiError.from(error).code === 'NOTHING_TO_RESOLVE') refresh();
    },
  });

  return (
    <Card className="p-5">
      <form noValidate className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit((form) => action.mutate(form.note))(event)}>
        <h2 className="text-lg font-bold tracking-tight text-slate-900">{text.heading}</h2>
        <p className="text-sm text-slate-600">{text.help}</p>
        <TextAreaField label="Note" optional={kind === 'resolve'} rows={3} maxLength={500} error={errors.note?.message} {...register('note')} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={action.isPending}>{text.submit}</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {action.isError && <ProblemAlert error={action.error} />}
      </form>
    </Card>
  );
}
