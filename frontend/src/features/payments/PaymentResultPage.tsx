import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { BedDouble, Clock, Plane } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { PaymentFailedIllustration, PaymentSuccessIllustration, StormIllustration } from '@/components/illustrations';
import { Alert } from '@/components/ui/Alert';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/StateViews';
import { BookingSteps } from '@/features/bookings/BookingParts';
import { Art, BookingPageSkeleton, WaitingRing } from '@/features/bookings/BookingUi';
import { dateOf, timeOf } from '@/features/flights/flightFormat';
import { failureAdvice, isConfirmed, isProcessing } from '@/features/bookings/status';
import type { BookingDetails } from '@/features/bookings/types';
import { useBookingDetails } from '@/features/bookings/useBookingDetails';
import { ApiError } from '@/lib/api/apiError';
import { formatMoney, formatShortDate } from '@/lib/format';

/** After this long in "confirming with the airline" the page says it takes longer than usual (the outcome may be uncertain). */
const SLOW_AFTER_MS = 60_000;

/**
 * /my-trips/:bookingId/result — step 4. The result is never taken from the payment window: the page shows the
 * booking's real status and keeps updating until the hotel or airline has confirmed (payment success is not confirmation).
 */
export function PaymentResultPage() {
  const { bookingId = '' } = useParams();
  const booking = useBookingDetails(bookingId);

  if (booking.isPending) {
    return <PageContainer width="md"><BookingPageSkeleton label="Loading your booking…" aside={false} /></PageContainer>;
  }
  if (booking.isError) {
    return (
      <PageContainer width="md">
        <div className="mx-auto max-w-xl">
          <ErrorState illustration={<Art><StormIllustration /></Art>} description={ApiError.from(booking.error).message}
            onRetry={() => void booking.refetch()} />
        </div>
      </PageContainer>
    );
  }
  const data = booking.data;
  return (
    <PageContainer width="lg">
      <BookingSteps current={4} type={data.type} />
      <Card className="mx-auto mt-6 max-w-3xl overflow-hidden px-5 py-8 text-center sm:px-10 sm:py-10">
        <Outcome booking={data} />
      </Card>
    </PageContainer>
  );
}

/** True once `active` has been true for `afterMs` without a break. */
function useStayedLong(active: boolean, afterMs: number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const timer = window.setTimeout(() => setSlow(true), afterMs);
    return () => {
      window.clearTimeout(timer);
      setSlow(false);
    };
  }, [active, afterMs]);
  return slow;
}

/** The drawing or icon at the top of an outcome (decorative). */
function OutcomeArt({ children }: { children: ReactNode }) {
  return <div aria-hidden="true" className="mx-auto flex justify-center animate-scale-in">{children}</div>;
}

function Outcome({ booking }: { booking: BookingDetails }) {
  const { status } = booking;
  const flight = booking.type === 'FLIGHT';
  const processing = isProcessing(status);
  const slow = useStayedLong(processing && flight, SLOW_AFTER_MS);
  if (isConfirmed(status)) {
    return <Confirmed booking={booking} />;
  }
  if (processing) {
    return (
      <div role="status" aria-live="polite">
        <OutcomeArt><WaitingRing>{flight ? <Plane /> : <BedDouble />}</WaitingRing></OutcomeArt>
        <h1 className="mt-6 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {status === 'INITIATED'
            ? (flight ? 'Securing your seats…' : 'Securing your room…')
            : `Payment received. Confirming with the ${flight ? 'airline' : 'hotel'}…`}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
          {status === 'INITIATED'
            ? `We are holding your ${flight ? 'seats' : 'room'}. This takes a few seconds.`
            : `Your payment is safe. We are getting the final confirmation from the ${flight ? 'airline' : 'hotel'}. Please keep this page open.`}
        </p>
        {slow && (
          <Alert tone="info" className="mx-auto mt-5 max-w-md text-left" title="The airline is taking longer than usual">
            Your payment is safe. We keep checking with the airline and will email you the e-ticket as soon as it is issued.
            If it cannot be issued, your payment is refunded in full. You do not need to pay again or stay on this page.
          </Alert>
        )}
      </div>
    );
  }
  if (status === 'PENDING_PAYMENT') {
    const failed = booking.paymentStatus === 'PAYMENT_FAILED';
    const held = flight ? 'seats are' : 'room is';
    return (
      <div role="status">
        <OutcomeArt>
          {failed
            ? <Art><PaymentFailedIllustration /></Art>
            : <span className="flex size-16 items-center justify-center rounded-full bg-warning-50 text-warning-600 ring-8 ring-warning-50/60"><Clock className="size-8" /></span>}
        </OutcomeArt>
        <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{failed ? 'Payment failed' : 'We have not confirmed your payment yet'}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
          {failed
            ? `Your payment did not go through and no money was taken. Your ${held} still held for a little while.`
            : `If you just paid, this page updates by itself within a minute. If you did not, you can pay now while your ${held} held.`}
        </p>
        {booking.canPay && (
          <ButtonLink to={`/my-trips/${booking.id}/pay`} size="lg" className="mt-6">
            {failed ? 'Try again' : 'Go to payment'}
          </ButtonLink>
        )}
      </div>
    );
  }
  if (status === 'REFUND_PENDING' || status === 'REFUNDED') {
    return (
      <div role="status">
        <OutcomeArt><Art><PaymentFailedIllustration /></Art></OutcomeArt>
        <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {status === 'REFUNDED' ? 'Your payment was refunded' : 'We could not confirm your booking'}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
          {booking.failureMessage ?? (status === 'REFUNDED'
            ? 'The full amount was returned to your original payment method.'
            : 'Your payment is being refunded in full. Banks usually take 5 to 7 working days to show it.')}
        </p>
        <Links booking={booking} />
      </div>
    );
  }
  // FAILED, EXPIRED, CANCELLED
  return (
    <div role="status">
      <OutcomeArt><Art><PaymentFailedIllustration /></Art></OutcomeArt>
      <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">This booking was not completed</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">{booking.failureMessage ?? failureAdvice(booking.failureReason, booking.type)}</p>
      <Links booking={booking} />
    </div>
  );
}

/** One line of the confirmation "ticket". */
function Line({ label, children, strong = false }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={strong ? 'text-right font-bold text-slate-900' : 'text-right font-semibold text-slate-800'}>{children}</dd>
    </div>
  );
}

function Confirmed({ booking }: { booking: BookingDetails }) {
  const hotel = booking.hotel;
  const flight = booking.flight;
  return (
    <div>
      <OutcomeArt><Art size="lg"><PaymentSuccessIllustration /></Art></OutcomeArt>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Your booking is confirmed</h1>
      <p className="mt-1.5 text-sm text-slate-600">We sent the confirmation to {booking.contactEmail}.</p>
      <dl className="relative mx-auto mt-7 max-w-md divide-y divide-dashed divide-slate-200 rounded-2xl border border-slate-200 bg-gradient-to-b from-role-50/70 to-white px-5 py-3 text-left text-sm shadow-xs">
        <Line label="Booking reference" strong>{booking.reference}</Line>
        {hotel?.confirmationNumber && <Line label="Hotel confirmation no." strong>{hotel.confirmationNumber}</Line>}
        {hotel?.hotelName && <Line label="Hotel">{hotel.hotelName}, {hotel.city}</Line>}
        {hotel?.checkIn && hotel.checkOut && <Line label="Stay">{formatShortDate(hotel.checkIn)} to {formatShortDate(hotel.checkOut)}</Line>}
        {flight?.pnr && <Line label="Airline reference (PNR)" strong>{flight.pnr}</Line>}
        {booking.type === 'FLIGHT' && booking.title && <Line label="Route">{booking.title}</Line>}
        {flight?.slices.map((slice) => (
          <Line key={slice.departureLocal} label={`${slice.origin} to ${slice.destination}`}>
            {formatShortDate(dateOf(slice.departureLocal))} {timeOf(slice.departureLocal)}
          </Line>
        ))}
        <Line label="Total paid" strong>{formatMoney(booking.totalAmount, booking.currency, true)}</Line>
      </dl>
      {booking.demo && (
        <Alert tone="info" className="mx-auto mt-4 max-w-md text-left">
          {booking.type === 'FLIGHT'
            ? 'This is a demo booking with demo flight inventory. No real ticket is issued.'
            : 'This is a demo booking with sample hotel data. No real room is reserved.'}
        </Alert>
      )}
      <Links booking={booking} />
    </div>
  );
}

function Links({ booking }: { booking: BookingDetails }) {
  return (
    <div className="mt-7 flex flex-wrap justify-center gap-3">
      <ButtonLink to={`/my-trips/${booking.id}`}>View booking</ButtonLink>
      <ButtonLink to="/my-trips" variant="secondary">My Trips</ButtonLink>
      <ButtonLink to="/account/payments" variant="ghost">Payment history</ButtonLink>
    </div>
  );
}
