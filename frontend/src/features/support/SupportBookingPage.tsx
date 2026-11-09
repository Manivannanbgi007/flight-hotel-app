import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useParams } from 'react-router';
import { AlertTriangle, BedDouble, Plane } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/app/providers/useAuth';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { PaymentsCard, Timeline, TripSections } from '@/features/bookings/BookingDetailsPage';
import { BookingStatusBadge, PriceBreakdown } from '@/features/bookings/BookingParts';
import { CancelBookingForm } from '@/features/bookings/CancelBookingForm';
import { canRetryRefund, latestRefund } from '@/features/bookings/cancellation';
import { CancellationCard } from '@/features/bookings/CancellationParts';
import { DemoInventoryBadge } from '@/features/flights/FlightBadges';
import { DemoBadge } from '@/features/hotels/HotelBadges';
import { bookingPaymentStatusInfo } from '@/features/bookings/status';
import type { Attention, BookingDetails, SupportNote } from '@/features/bookings/types';
import { useBookingDetails } from '@/features/bookings/useBookingDetails';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { hasPermission } from '@/lib/auth/types';
import { formatDateTime, formatMoney } from '@/lib/format';
import {
  attentionLabel,
  escalateNoteSchema,
  resolveNoteSchema,
  supportNoteActionLabels,
  supportNoteAuthor,
  type NoteForm,
} from './attention';
import { supportApi } from './supportApi';

/**
 * /support/bookings/:bookingId — Booking assist: everything about one booking (read-only), the attention flag, and the
 * actions the agent's permissions allow. Hidden actions are also refused by the API.
 */
export function SupportBookingPage() {
  const { bookingId = '' } = useParams();
  const booking = useBookingDetails(bookingId);

  if (booking.isPending) {
    return <LoadingState label="Loading the booking…" rows={4} />;
  }
  if (booking.isError) {
    const error = ApiError.from(booking.error);
    return (
      <div className="flex flex-col items-center gap-4">
        <ErrorState title={error.status === 404 ? 'Booking not found' : undefined} description={error.message}
          correlationId={error.correlationId} onRetry={error.status === 404 ? undefined : () => void booking.refetch()} />
        <Link to="/support/bookings" className="font-medium text-role-700 hover:underline">Booking lookup</Link>
      </div>
    );
  }
  return <Assist booking={booking.data} />;
}

type Panel = 'cancel' | 'escalate' | 'resolve' | null;

function Assist({ booking }: { booking: BookingDetails }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const manage = hasPermission(user, 'BOOKING_MANAGE_ANY');
  const manageRefunds = hasPermission(user, 'REFUND_MANAGE');
  // Only a confirmed booking can be cancelled; the quote explains when it cannot (too late, ...).
  const canCancel = manage && (booking.canCancel || booking.status === 'CONFIRMED');
  const canResolve = manage && booking.attention !== null;
  const failedRefund = manageRefunds && canRetryRefund(booking) ? latestRefund(booking.refunds) : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(booking.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.timeline(booking.id) });
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
  const toggle = (next: Exclude<Panel, null>) => setPanel((current) => (current === next ? null : next));
  const payment = bookingPaymentStatusInfo[booking.paymentStatus];
  const retryError = retry.error ? ApiError.from(retry.error) : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm"><Link to="/support/bookings" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-semibold text-role-700 shadow-xs ring-1 ring-slate-200 transition-colors hover:bg-role-50">← Booking lookup</Link></p>
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

      {(canCancel || manage || failedRefund) && (
        <section aria-label="Actions" className="flex flex-wrap gap-2">
          {canCancel && (
            <Button variant="danger" aria-expanded={panel === 'cancel'} onClick={() => toggle('cancel')}>Cancel on behalf</Button>
          )}
          {manage && <Button variant="secondary" aria-expanded={panel === 'escalate'} onClick={() => toggle('escalate')}>Escalate</Button>}
          {canResolve && <Button variant="secondary" aria-expanded={panel === 'resolve'} onClick={() => toggle('resolve')}>Mark resolved</Button>}
          {failedRefund && (
            <Button loading={retry.isPending} onClick={() => retry.mutate()}>
              Retry refund of {formatMoney(failedRefund.amount, failedRefund.currency, true)}
            </Button>
          )}
        </section>
      )}
      {retryError && (
        <Alert tone="danger" title="The refund was not requested again">
          {retryError.message}
          {retryError.correlationId && <span className="block text-xs">Support reference: {retryError.correlationId}</span>}
        </Alert>
      )}
      {panel === 'cancel' && <CancelPanel booking={booking} canWaiveFee={manageRefunds} onClose={() => setPanel(null)} />}
      {panel === 'escalate' && <NotePanel bookingId={booking.id} kind="escalate" onClose={() => setPanel(null)} />}
      {panel === 'resolve' && <NotePanel bookingId={booking.id} kind="resolve" onClose={() => setPanel(null)} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <CancellationCard booking={booking} viewer="staff" />
          <TripSections booking={booking} />
          <PaymentsCard bookingId={booking.id} status={booking.status} />
          <Timeline bookingId={booking.id} type={booking.type} />
        </div>
        <Card className="h-fit p-5">
          {booking.priceItems.length > 0
            ? <PriceBreakdown items={booking.priceItems} total={booking.totalAmount} currency={booking.currency} />
            : <p className="text-sm text-slate-600">No price yet: nothing was held.</p>}
          {booking.couponCode && <p className="mt-3 text-sm text-slate-600">Coupon <strong>{booking.couponCode}</strong></p>}
          {booking.couponNote && <p className="mt-1 text-sm text-slate-600">{booking.couponNote}</p>}
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

/** The internal support history (staff only: customers never see these notes). Oldest first, as the server sends it. */
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

function CancelPanel({ booking, canWaiveFee, onClose }: { booking: BookingDetails; canWaiveFee: boolean; onClose: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <Card className="p-5">
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold tracking-tight text-slate-900">Cancel on behalf of the customer</h2>
      <p className="mt-1 text-sm text-slate-600">
        The reason is shown to the customer and kept in the audit log. The booking is cancelled once the {booking.type === 'FLIGHT' ? 'airline' : 'hotel'} confirms.
      </p>
      <div className="mt-4">
        <CancelBookingForm
          booking={booking}
          mode="staff"
          canWaiveFee={canWaiveFee}
          onCancelled={() => {
            toast.success('Cancellation requested for the customer.');
            onClose();
          }}
          secondaryAction={<Button variant="ghost" onClick={onClose}>Close</Button>}
        />
      </div>
    </Card>
  );
}

const NOTE_TEXT = {
  escalate: {
    heading: 'Escalate this booking',
    help: 'The booking goes to the "Needs attention" queue. Notes are internal: the customer never sees them.',
    submit: 'Escalate booking',
    done: 'Escalated. The booking is in the "Needs attention" queue.',
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
  const noteId = useId();
  const errorId = useId();
  const { register, handleSubmit, formState: { errors } } = useForm<NoteForm>({
    resolver: zodResolver(kind === 'escalate' ? escalateNoteSchema : resolveNoteSchema),
    defaultValues: { note: '' },
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(bookingId) });
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
      if (ApiError.from(error).code === 'NOTHING_TO_RESOLVE') {
        refresh();
      }
    },
  });
  const problem = action.error ? ApiError.from(action.error) : null;

  return (
    <Card className="p-5">
      <form noValidate className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit((form) => action.mutate(form.note))(event)}>
        <h2 className="text-lg font-bold tracking-tight text-slate-900">{text.heading}</h2>
        <p className="text-sm text-slate-600">{text.help}</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="text-sm font-medium text-slate-800">
            Note{kind === 'resolve' && <span className="font-normal text-slate-500"> (optional)</span>}
          </label>
          <textarea
            id={noteId}
            rows={3}
            maxLength={500}
            autoFocus
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? errorId : undefined}
            className={errors.note ? 'rounded-lg border border-danger-600 px-3 py-2 text-sm' : 'rounded-lg border border-slate-300 px-3 py-2 text-sm'}
            {...register('note')}
          />
          {errors.note && <p id={errorId} className="text-sm text-danger-600">{errors.note.message}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={action.isPending}>{text.submit}</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {problem && (
          <Alert tone="danger">
            {problem.message}
            {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
          </Alert>
        )}
      </form>
    </Card>
  );
}
