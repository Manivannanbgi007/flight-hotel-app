import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextAreaField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { todayIso } from '@/features/account/schemas';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { LoadingState } from '@/components/ui/StateViews';
import { HotelPageError, ReservationStatusBadge } from './ManagerParts';
import { operationsApi } from './operationsApi';
import type { ReservationDetails, ReservationGuest } from './operationsTypes';
import { guestLabel, reservationActions } from './reservationStatus';
import { HOTEL_CANCEL_REASON_MAX, hotelCancelSchema, type HotelCancelForm } from './schemas';

/**
 * /hotel-manager/hotels/:hotelId/reservations/:reservationId — guest management: the stay, the guests per room, contact
 * details, special requests, and the front-desk actions the status and date allow (check in, check out, no-show, cancel
 * for the hotel). Live: `hotel.reservation-changed` refreshes it.
 */
export function ReservationDetailsPage() {
  const { hotelId = '', reservationId = '' } = useParams();
  const reservation = useQuery({
    queryKey: queryKeys.hotelManager.reservation(hotelId, reservationId),
    queryFn: () => operationsApi.reservation(hotelId, reservationId),
  });
  const back = (
    <p className="text-sm">
      <Link to={`/hotel-manager/hotels/${hotelId}/reservations`} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-semibold text-role-700 shadow-xs ring-1 ring-slate-200 transition-colors hover:bg-role-50">← Reservations</Link>
    </p>
  );

  if (reservation.isPending) {
    return <LoadingState label="Loading the reservation…" rows={4} />;
  }
  if (reservation.isError) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <HotelPageError error={reservation.error} onRetry={() => void reservation.refetch()} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {back}
      <Details hotelId={hotelId} reservation={reservation.data} />
    </div>
  );
}

type FrontDeskAction = 'checkIn' | 'checkOut' | 'noShow';
type Panel = 'checkOutEarly' | 'noShow' | 'cancel' | null;

const DONE: Record<FrontDeskAction, string> = {
  checkIn: 'Guest checked in.',
  checkOut: 'Guest checked out. The booking is completed.',
  noShow: 'Marked as no-show.',
};
const FAILED: Record<FrontDeskAction, string> = {
  checkIn: 'Could not check in',
  checkOut: 'Could not check out',
  noShow: 'Could not mark as no-show',
};

/** After any action: the reservation, the lists, the dashboard, rooms for sale and the reports change. */
function useRefreshHotel(hotelId: string) {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of [
      queryKeys.hotelManager.reservations(hotelId),
      queryKeys.hotelManager.dashboard(hotelId),
      queryKeys.hotelManager.inventory(hotelId),
      queryKeys.hotelManager.reports(hotelId),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}

function Details({ hotelId, reservation }: { hotelId: string; reservation: ReservationDetails }) {
  const refresh = useRefreshHotel(hotelId);
  const [panel, setPanel] = useState<Panel>(null);
  const today = todayIso();
  const actions = reservationActions(reservation, today);
  const anyAction = actions.checkIn || actions.checkOut || actions.noShow || actions.cancel;

  const run = useMutation({
    mutationFn: (action: FrontDeskAction) => {
      if (action === 'checkIn') return operationsApi.checkIn(hotelId, reservation.reservationId);
      if (action === 'checkOut') return operationsApi.checkOut(hotelId, reservation.reservationId);
      return operationsApi.noShow(hotelId, reservation.reservationId);
    },
    onSuccess: (_result, action) => {
      setPanel(null);
      toast.success(DONE[action]);
      refresh();
    },
    // The reservation changed meanwhile (409): show what it is now.
    onError: (error) => {
      if (ApiError.from(error).status === 409) refresh();
    },
  });
  const problem = run.error ? ApiError.from(run.error) : null;
  const start = (action: FrontDeskAction) => {
    run.reset();
    run.mutate(action);
  };

  return (
    <>
      <header className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card animate-fade-up">
        <p className="text-xs font-semibold uppercase tracking-wider text-role-700">Reservation</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="break-words text-xl font-bold tracking-tight text-slate-900">{guestLabel(reservation)}</h2>
          <ReservationStatusBadge status={reservation.status} />
          <LiveIndicator className="ml-auto" />
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {[
            reservation.bookingReference && `Booking ${reservation.bookingReference}`,
            reservation.confirmationNumber && `Confirmation no. ${reservation.confirmationNumber}`,
          ].filter(Boolean).join(' · ')}
        </p>
      </header>

      {(anyAction || actions.checkInOpensOn) && (
        <section aria-label="Actions" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {actions.checkIn && <Button loading={run.isPending && run.variables === 'checkIn'} onClick={() => start('checkIn')}>Check in</Button>}
            {actions.checkOut && (
              <Button loading={run.isPending && run.variables === 'checkOut'}
                onClick={() => (today < reservation.checkOut ? setPanel('checkOutEarly') : start('checkOut'))}>
                Check out
              </Button>
            )}
            {actions.noShow && <Button variant="secondary" onClick={() => setPanel('noShow')}>No-show</Button>}
            {actions.cancel && <Button variant="secondary" onClick={() => setPanel('cancel')}>Cancel (hotel)</Button>}
          </div>
          {actions.checkInOpensOn && !actions.checkIn && (
            <p className="text-sm text-slate-600">Check-in opens on {formatDate(actions.checkInOpensOn)}.</p>
          )}
          {problem && (
            <Alert tone="danger" title={FAILED[run.variables ?? 'checkIn']}>
              {problem.message}
              {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
            </Alert>
          )}
          {panel === 'checkOutEarly' && (
            <ConfirmPanel title="Check out early?" confirmLabel="Check out now" loading={run.isPending}
              onConfirm={() => start('checkOut')} onCancel={() => setPanel(null)}>
              The stay was booked until {formatDate(reservation.checkOut)}. Checking out now completes the booking.
            </ConfirmPanel>
          )}
          {panel === 'noShow' && (
            <ConfirmPanel title="Mark as no-show?" confirmLabel="Yes, the guest did not arrive" loading={run.isPending}
              onConfirm={() => start('noShow')} onCancel={() => setPanel(null)}>
              Use this when the guest did not arrive. It cannot be undone.
            </ConfirmPanel>
          )}
          {panel === 'cancel' && (
            <CancelPanel hotelId={hotelId} reservation={reservation} onDone={() => setPanel(null)} onCancel={() => setPanel(null)} />
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-semibold text-slate-900">Stay</h3>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Item label="Check-in">{formatDate(reservation.checkIn)}</Item>
            <Item label="Check-out">{formatDate(reservation.checkOut)}</Item>
            <Item label="Nights">{reservation.nights}</Item>
            <Item label="Room">
              {reservation.rooms} × {reservation.roomTypeName ?? 'Room'}
              {reservation.ratePlanName && <span className="block font-normal text-slate-600">{reservation.ratePlanName}</span>}
            </Item>
            <Item label="Guests">
              {reservation.adults} adult{reservation.adults === 1 ? '' : 's'}
              {reservation.children > 0 ? `, ${reservation.children} child${reservation.children === 1 ? '' : 'ren'}` : ''}
            </Item>
            {reservation.totalAmount !== null && (
              <Item label="Total">
                {formatMoney(reservation.totalAmount, reservation.currency ?? 'INR', true)}
                {reservation.taxes != null && (
                  <span className="block font-normal text-slate-600">incl. {formatMoney(reservation.taxes, reservation.currency ?? 'INR', true)} GST</span>
                )}
              </Item>
            )}
          </dl>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-slate-900">Guests</h3>
          <GuestList guests={reservation.guests} />
          <h3 className="mt-4 font-semibold text-slate-900">Contact</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {reservation.contactEmail && (
              <li><a href={`mailto:${reservation.contactEmail}`} className="break-all text-role-700 hover:underline">{reservation.contactEmail}</a></li>
            )}
            {reservation.contactPhone && (
              <li><a href={`tel:${reservation.contactPhone}`} className="text-role-700 hover:underline">{reservation.contactPhone}</a></li>
            )}
            {!reservation.contactEmail && !reservation.contactPhone && <li className="text-slate-500">No contact details.</li>}
          </ul>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-slate-900">Special requests</h3>
          <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-700">{reservation.specialRequests || 'None.'}</p>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-slate-900">History</h3>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Item label="Booked">{formatDateTime(reservation.createdAt)}</Item>
            {reservation.confirmedAt && <Item label="Confirmed">{formatDateTime(reservation.confirmedAt)}</Item>}
            {reservation.checkedInAt && <Item label="Checked in">{formatDateTime(reservation.checkedInAt)}</Item>}
            {reservation.checkedOutAt && <Item label="Checked out">{formatDateTime(reservation.checkedOutAt)}</Item>}
            {reservation.cancelledAt && (
              <Item label="Cancelled">
                {formatDateTime(reservation.cancelledAt)}
                {reservation.cancelledBy && (
                  <span className="block font-normal text-slate-600">
                    {reservation.cancelledBy === 'HOTEL' ? 'By the hotel (guest refunded in full)' : 'By the guest'}
                  </span>
                )}
              </Item>
            )}
            {reservation.noShowAt && <Item label="Marked as no-show">{formatDateTime(reservation.noShowAt)}</Item>}
            {reservation.cancellationReason && <Item label="Reason for cancelling">{reservation.cancellationReason}</Item>}
            {reservation.cancellationReference && <Item label="Cancellation reference">{reservation.cancellationReference}</Item>}
          </dl>
        </Card>
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{children}</dd>
    </div>
  );
}

function GuestList({ guests }: { guests: ReservationGuest[] }) {
  if (guests.length === 0) {
    return <p className="mt-2 text-sm text-slate-500">No guest names yet.</p>;
  }
  const rooms = [...new Set(guests.map((guest) => guest.roomNo))].sort((a, b) => a - b);
  return (
    <ul aria-label="Guests per room" className="mt-2 flex flex-col gap-1 text-sm text-slate-700">
      {rooms.map((roomNo) => (
        <li key={roomNo}>
          <span className="font-medium text-slate-900">Room {roomNo}:</span>{' '}
          {guests.filter((guest) => guest.roomNo === roomNo).map((guest) => `${guest.firstName} ${guest.lastName}`).join(', ')}
        </li>
      ))}
    </ul>
  );
}

/** A second step for actions that cannot be undone. The heading takes the focus so screen readers announce it. */
function ConfirmPanel({ title, confirmLabel, loading, onConfirm, onCancel, children }: {
  title: string;
  confirmLabel: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold text-slate-900 focus:outline-none">{title}</h3>
      <p className="mt-1 text-sm text-slate-700">{children}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        <Button variant="ghost" onClick={onCancel}>Keep as it is</Button>
      </div>
    </section>
  );
}

function CancelPanel({ hotelId, reservation, onDone, onCancel }: {
  hotelId: string;
  reservation: ReservationDetails;
  onDone: () => void;
  onCancel: () => void;
}) {
  const refresh = useRefreshHotel(hotelId);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const [shownOnField, setShownOnField] = useState(false);
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<HotelCancelForm>({
    resolver: zodResolver(hotelCancelSchema),
    defaultValues: { reason: '' },
  });
  const reason = useWatch({ control, name: 'reason' }) ?? '';

  const cancel = useMutation({
    mutationFn: (form: HotelCancelForm) => operationsApi.cancel(hotelId, reservation.reservationId, form.reason.trim()),
    onMutate: () => setShownOnField(false),
    onSuccess: () => {
      toast.success('Stay cancelled. The guest is refunded in full.');
      refresh();
      onDone();
    },
    onError: (error) => {
      const problem = ApiError.from(error);
      if (problem.status === 409) refresh();
      setShownOnField(applyServerErrors(problem, setError, ['reason']));
    },
  });
  const problem = cancel.error && !shownOnField ? ApiError.from(cancel.error) : null;

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-danger-200 bg-danger-50/60 p-4">
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold text-slate-900 focus:outline-none">
        Cancel this stay for the hotel
      </h3>
      <p className="mt-1 text-sm text-slate-700">
        Only do this when the hotel cannot host the guest, for example after an overbooking or a closure.
        The guest gets a <strong>full refund</strong> of everything they paid, and the rooms go back on sale.
      </p>
      <form noValidate className="mt-3 flex flex-col gap-3" onSubmit={handleSubmit((form) => cancel.mutate(form))}>
        <TextAreaField label="Reason" rows={3} maxLength={HOTEL_CANCEL_REASON_MAX}
          hint={`${reason.length} / ${HOTEL_CANCEL_REASON_MAX} characters`} error={errors.reason?.message} {...register('reason')} />
        {problem && (
          <Alert tone="danger" title="The stay was not cancelled">
            {problem.message}
            {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="danger" loading={cancel.isPending}>Cancel stay and refund in full</Button>
          <Button variant="ghost" onClick={onCancel}>Keep the reservation</Button>
        </div>
      </form>
    </section>
  );
}
