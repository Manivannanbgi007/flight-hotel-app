import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { BedDouble, Lock, ShieldCheck, UserRound } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CheckboxField } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { DemoBadge } from '@/features/hotels/HotelBadges';
import { hotelApi } from '@/features/hotels/hotelApi';
import { describeGuests } from '@/features/hotels/searchParams';
import type { Quote } from '@/features/hotels/types';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatMoney, formatShortDate } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import { bookingApi } from './bookingApi';
import { clearDraft, loadDraft, newIdempotencyKey, saveDraft, type BookingDraft } from './bookingDraft';
import { BookingSteps } from './BookingParts';
import { BookingPageSkeleton, DetailCard, Fact, IconTile } from './BookingUi';
import { QuoteProblem } from './GuestDetailsPage';
import { PriceHold } from './StaySummaryCard';

/**
 * /book/hotel/:quoteId/review — step 2: everything the customer entered next to the price, then "Confirm and pay".
 * The server recalculates every amount when the hotel holds the room; this page only shows the quote.
 */
export function BookingReviewPage() {
  const { quoteId = '' } = useParams();
  // Read once: after the booking is made the draft is deleted, and that must not send the customer back to step 1.
  const [draft] = useState(() => loadDraft(quoteId));
  const quote = useQuery({
    queryKey: queryKeys.hotels.quote(quoteId),
    queryFn: () => hotelApi.getQuote(quoteId),
    retry: false,
    staleTime: Infinity,
  });

  if (!draft) {
    return <Navigate to={`/book/hotel/${quoteId}`} replace />;
  }
  if (quote.isPending) {
    return <PageContainer width="lg"><BookingPageSkeleton label="Loading your booking…" /></PageContainer>;
  }
  if (quote.isError) {
    return <QuoteProblem error={ApiError.from(quote.error)} onRetry={() => void quote.refetch()} />;
  }
  return <Review quote={quote.data} draft={draft} />;
}

function Review({ quote, draft }: { quote: Quote; draft: BookingDraft }) {
  const navigate = useNavigate();
  const remaining = useCountdown(quote.expiresAt);
  const expired = remaining <= 0;
  const [accepted, setAccepted] = useState(false);
  const [showAcceptError, setShowAcceptError] = useState(false);
  const keyRef = useRef(draft.idempotencyKey);

  const book = useMutation({
    mutationFn: () => {
      // The key is made once, kept here and in the draft: a retry (timeout, reload) returns the same booking.
      const key = keyRef.current ?? newIdempotencyKey();
      if (!keyRef.current) {
        keyRef.current = key;
        saveDraft({ ...draft, idempotencyKey: key });
      }
      return bookingApi.createHotelBooking({
        quoteId: quote.quoteId,
        contact: draft.contact,
        guests: draft.guests.map((guest, index) => ({ roomNo: index + 1, ...guest })),
        specialRequests: draft.specialRequests || undefined,
        couponCode: draft.couponCode || undefined,
      }, key);
    },
    onSuccess: (booking) => {
      clearDraft(quote.quoteId);
      void navigate(`/my-trips/${booking.id}/pay`);
    },
  });

  const confirm = () => {
    if (!accepted) {
      setShowAcceptError(true);
      return;
    }
    book.mutate();
  };

  const error = book.error ? ApiError.from(book.error) : null;
  return (
    <PageContainer width="lg">
      <BookingSteps current={2} />
      <PageHeader
        className="mt-6"
        title="Review your booking"
        description="Check the stay, the guests and the price. You pay on the next step."
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-hidden">
            <div className="flex items-start gap-4 border-b border-slate-100 bg-gradient-sky px-5 py-5 sm:px-6">
              <IconTile size="lg"><BedDouble /></IconTile>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold tracking-tight text-slate-900">{quote.hotelName}</h2>
                  {quote.demo && <DemoBadge />}
                </div>
                <p className="text-sm text-slate-600">{quote.hotelAddress}</p>
              </div>
            </div>
            <dl className="grid gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
              <Fact label="Check-in">{formatShortDate(quote.checkIn)}, from {quote.checkInTime.slice(0, 5)}</Fact>
              <Fact label="Check-out">{formatShortDate(quote.checkOut)}, until {quote.checkOutTime.slice(0, 5)}</Fact>
              <Fact label="Room">{quote.roomTypeName} · {quote.ratePlanName}</Fact>
              <Fact label="Stay">{describeGuests(quote)} · {quote.nights} night{quote.nights === 1 ? '' : 's'}</Fact>
            </dl>
          </Card>

          <DetailCard
            title="Guests and contact"
            icon={<UserRound />}
            actions={<Link to={`/book/hotel/${quote.quoteId}`} className="rounded-md text-sm font-semibold text-role-700 hover:underline">Edit</Link>}
          >
            <ul className="mt-3 flex flex-col gap-1 text-sm text-slate-700">
              {draft.guests.map((guest, index) => (
                <li key={index}>{draft.guests.length > 1 ? `Room ${index + 1}: ` : 'Guest: '}{guest.firstName} {guest.lastName}</li>
              ))}
            </ul>
            <p className="mt-2 break-words text-sm text-slate-700">{draft.contact.email} · {draft.contact.phone}</p>
            {draft.specialRequests && <p className="mt-2 text-sm text-slate-600">Request: {draft.specialRequests}</p>}
            {draft.couponCode && <p className="mt-2 text-sm text-slate-600">Coupon: <strong>{draft.couponCode}</strong> (applied to the final price)</p>}
          </DetailCard>

          <DetailCard title="Cancellation" icon={<ShieldCheck />}>
            <p className="mt-3 text-sm text-slate-700">{quote.cancellationPolicy}</p>
          </DetailCard>

          <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-xs sm:px-5">
            <CheckboxField
              checked={accepted}
              onChange={(event) => { setAccepted(event.target.checked); setShowAcceptError(false); }}
              label="I accept the cancellation policy and the terms of this booking."
              error={showAcceptError ? 'Please accept to continue' : undefined}
            />
          </div>
          {error && (
            <Alert tone="danger" title="We could not start your booking">
              {error.message}
              {error.correlationId && <span className="block text-xs">Support reference: {error.correlationId}</span>}
            </Alert>
          )}
        </div>

        <Card className="h-fit p-5 lg:sticky lg:top-24">
          <h2 className="text-base font-bold tracking-tight text-slate-900">Price details</h2>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm text-slate-700">
            {quote.nightlyPrices.map((night) => (
              <li key={night.date} className="flex justify-between gap-2">
                <span>{formatShortDate(night.date)}{quote.rooms > 1 ? ` × ${quote.rooms}` : ''}</span>
                <span className="tabular-nums">{formatMoney(night.price * quote.rooms, quote.currency, true)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 flex flex-col gap-1.5 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between text-slate-700"><dt>Subtotal</dt><dd className="tabular-nums">{formatMoney(quote.subtotal, quote.currency, true)}</dd></div>
            {quote.taxLines.map((line) => (
              <div key={line.label} className="flex justify-between text-slate-600"><dt>{line.label}</dt><dd className="tabular-nums">{formatMoney(line.amount, quote.currency, true)}</dd></div>
            ))}
            <div className="mt-2 flex items-baseline justify-between rounded-xl bg-role-50/70 px-3 py-2.5 text-base font-bold text-slate-900 ring-1 ring-inset ring-role-100">
              <dt>Total</dt><dd className="tabular-nums">{formatMoney(quote.total, quote.currency, true)}</dd>
            </div>
          </dl>
          {draft.couponCode && <p className="mt-2 text-xs text-slate-500">Your coupon is taken off when the room is held.</p>}
          <PriceHold remaining={remaining} className="mt-4" />
          <Button size="lg" className="mt-4 w-full" loading={book.isPending} disabled={expired} onClick={confirm}>
            Confirm and continue to payment
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
            <Lock className="size-3.5 shrink-0" aria-hidden="true" />You pay on the next step. Nothing is charged yet.
          </p>
        </Card>
      </div>
    </PageContainer>
  );
}
