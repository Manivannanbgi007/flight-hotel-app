import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { CalendarClock, CreditCard, History, LifeBuoy, ReceiptText, ShieldCheck, UserRound } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { BoardingPassIllustration, HotelIllustration, LostIllustration, StormIllustration } from '@/components/illustrations';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/StateViews';
import { DocumentsCard } from '@/features/documents/DocumentsCard';
import { DemoInventoryBadge } from '@/features/flights/FlightBadges';
import { DemoBadge } from '@/features/hotels/HotelBadges';
import { paymentApi } from '@/features/payments/paymentApi';
import { paymentStatusInfo } from '@/features/payments/paymentStatus';
import { ReviewPrompt } from '@/features/reviews/ReviewPrompt';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { formatCountdown, useCountdown } from '@/lib/useCountdown';
import { dangerLinkClass } from './actionStyles';
import { bookingApi } from './bookingApi';
import { BookingStatusBadge, PriceBreakdown } from './BookingParts';
import { Art, BackLink, BookingPageSkeleton, DetailCard, Fact, factGrid, TripTypeIcon } from './BookingUi';
import { CancellationCard } from './CancellationParts';
import { FlightBookingSection } from './FlightParts';
import { isConfirmed, statusDescription, statusInfo, statusLabel } from './status';
import type { BookingDetails } from './types';
import { useBookingDetails } from './useBookingDetails';

/**
 * /my-trips/:bookingId — everything about one booking: status, stay, guests, price, documents (PDFs), payments, invoice,
 * timeline, and the cancellation with its refunds. "Cancel booking" appears when the server allows it (`canCancel`);
 * "Get help with this booking" opens a support ticket with the booking selected.
 */
export function BookingDetailsPage() {
  const { bookingId = '' } = useParams();
  const booking = useBookingDetails(bookingId);

  if (booking.isPending) {
    return <PageContainer width="lg"><BookingPageSkeleton label="Loading your booking…" /></PageContainer>;
  }
  if (booking.isError) {
    const error = ApiError.from(booking.error);
    return (
      <PageContainer width="md">
        <div className="mx-auto max-w-xl">
          <ErrorState title={error.status === 404 ? 'Booking not found' : undefined} description={error.message}
            illustration={<Art>{error.status === 404 ? <LostIllustration /> : <StormIllustration />}</Art>}
            onRetry={error.status === 404 ? undefined : () => void booking.refetch()} />
          <p className="mt-4 text-center"><Link to="/my-trips" className="font-semibold text-role-700 hover:underline">My Trips</Link></p>
        </div>
      </PageContainer>
    );
  }
  return <Details booking={booking.data} />;
}

function Details({ booking }: { booking: BookingDetails }) {
  const info = statusInfo[booking.status];
  const flight = booking.type === 'FLIGHT';
  return (
    <PageContainer width="lg">
      <BackLink to="/my-trips">← My Trips</BackLink>

      <Card className="mt-3 overflow-hidden animate-fade-up">
        <div className="relative isolate flex items-start gap-4 bg-gradient-sky px-5 py-6 sm:px-7">
          <TripTypeIcon type={booking.type} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-role-700">{flight ? 'Flight booking' : 'Hotel stay'}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {booking.title ?? (flight ? 'Flight booking' : 'Hotel booking')}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <BookingStatusBadge status={booking.status} type={booking.type} paymentStatus={booking.paymentStatus} />
              {booking.demo && (flight ? <DemoInventoryBadge /> : <DemoBadge />)}
            </div>
          </div>
          <div aria-hidden="true" className="hidden w-36 shrink-0 self-center sm:block">
            {flight ? <BoardingPassIllustration /> : <HotelIllustration />}
          </div>
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-600 sm:px-7">
          Booking reference <strong className="font-bold text-slate-900">{booking.reference}</strong> · booked on {formatDateTime(booking.createdAt)}
        </p>
      </Card>

      <div className="mt-4 flex flex-col gap-3">
        <Alert tone={info.tone === 'neutral' ? 'info' : info.tone} title={statusLabel(booking.status, booking.type, booking.paymentStatus)}>
          {booking.failureMessage ?? statusDescription(booking.status, booking.type, booking.paymentStatus)}
        </Alert>
        {booking.couponNote && <Alert tone="warning" title="Coupon not applied">{booking.couponNote}</Alert>}
        {booking.canPay && <PayNow booking={booking} />}
        {booking.canCancel && <CancelAction booking={booking} />}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <CancellationCard booking={booking} />
          <TripSections booking={booking} />
          <DocumentsCard booking={booking} />
          <PaymentsCard bookingId={booking.id} status={booking.status} />
          <Timeline bookingId={booking.id} type={booking.type} />
        </div>

        <div className="flex h-fit min-w-0 flex-col gap-4">
          <ReviewPrompt booking={booking} />
          <Card className="p-5 sm:p-6">
            {booking.priceItems.length > 0
              ? <PriceBreakdown items={booking.priceItems} total={booking.totalAmount} currency={booking.currency} />
              : <p className="text-sm text-slate-600">The price is shown once the {flight ? 'seats are' : 'room is'} held.</p>}
            {booking.paymentStatus === 'PAID' && (
              <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-success-700">
                <ShieldCheck className="size-4" aria-hidden="true" />Paid in full
              </p>
            )}
          </Card>
          <Card variant="tinted" className="p-5">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><LifeBuoy className="size-5 text-role-600" aria-hidden="true" /> Need help?</h2>
            <p className="mt-1 text-sm text-slate-700">Our support team can see this booking and answer in your account.</p>
            <ButtonLink to={`/account/support/new?bookingId=${encodeURIComponent(booking.id)}`} variant="secondary" size="sm" className="mt-3">
              Get help with this booking
            </ButtonLink>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function CancelAction({ booking }: { booking: BookingDetails }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-xs">
      <p className="text-sm text-slate-700">Plans changed? See what you get back before you decide.</p>
      <Link to={`/my-trips/${booking.id}/cancel`} className={dangerLinkClass('md')}>
        Cancel booking
      </Link>
    </div>
  );
}

/** The stay or the flights, the guests and the cancellation rules (shared with the support booking page). */
export function TripSections({ booking }: { booking: BookingDetails }) {
  const hotel = booking.hotel;
  return (
    <>
      {hotel && (
        <DetailCard title="Your stay" icon={<CalendarClock />}>
          <p className="mt-2 text-sm text-slate-700">
            {hotel.hotelSlug ? <Link to={`/hotels/${hotel.hotelSlug}`} className="font-semibold text-role-700 hover:underline">{hotel.hotelName}</Link> : hotel.hotelName}
            {hotel.address ? `, ${hotel.address}` : ''}
          </p>
          <dl className={factGrid}>
            {hotel.checkIn && <Fact label="Check-in">{formatDate(hotel.checkIn)}{hotel.checkInTime ? `, from ${hotel.checkInTime}` : ''}</Fact>}
            {hotel.checkOut && <Fact label="Check-out">{formatDate(hotel.checkOut)}{hotel.checkOutTime ? `, until ${hotel.checkOutTime}` : ''}</Fact>}
            {hotel.roomTypeName && <Fact label="Room">{hotel.roomTypeName} · {hotel.ratePlanName}</Fact>}
            {hotel.nights && (
              <Fact label="Stay">
                {hotel.nights} night{hotel.nights === 1 ? '' : 's'}, {hotel.rooms} room{hotel.rooms === 1 ? '' : 's'}, {hotel.adults} adult{hotel.adults === 1 ? '' : 's'}
                {hotel.children ? `, ${hotel.children} child${hotel.children === 1 ? '' : 'ren'}` : ''}
              </Fact>
            )}
            {isConfirmed(booking.status) && hotel.confirmationNumber && (
              <Fact label="Hotel confirmation no." strong>{hotel.confirmationNumber}</Fact>
            )}
          </dl>
          {hotel.breakfastIncluded && <p className="mt-4"><Badge tone="success">Breakfast included</Badge></p>}
        </DetailCard>
      )}

      {hotel && hotel.guests.length > 0 && (
        <DetailCard title="Guests and contact" icon={<UserRound />}>
          <ul className="mt-3 flex flex-col gap-1 text-sm text-slate-700">
            {hotel.guests.map((guest) => (
              <li key={guest.roomNo}>{hotel.guests.length > 1 ? `Room ${guest.roomNo}: ` : 'Guest: '}{guest.firstName} {guest.lastName}</li>
            ))}
          </ul>
          <p className="mt-2 break-words text-sm text-slate-700">{booking.contactEmail} · {booking.contactPhone}</p>
          {hotel.specialRequests && <p className="mt-2 text-sm text-slate-600">Request: {hotel.specialRequests}</p>}
        </DetailCard>
      )}

      {hotel?.cancellation?.policy && (
        <DetailCard title="Cancellation" icon={<ShieldCheck />}>
          <p className="mt-3 text-sm text-slate-700">{hotel.cancellation.policy}</p>
          {hotel.cancellation.freeCancellationUntil && (
            <p className="mt-1 text-sm text-slate-600">Free cancellation until {formatDateTime(hotel.cancellation.freeCancellationUntil)}.</p>
          )}
        </DetailCard>
      )}

      {booking.flight && <FlightBookingSection flight={booking.flight} status={booking.status} />}
    </>
  );
}

function PayNow({ booking }: { booking: BookingDetails }) {
  const remaining = useCountdown(booking.paymentDeadline);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-medium text-warning-700">
        <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
        {remaining > 0 ? `Pay within ${formatCountdown(remaining)} to keep your ${booking.type === 'FLIGHT' ? 'seats' : 'room'}.` : 'The time to pay is over.'}
      </p>
      {remaining > 0 && (
        <ButtonLink to={`/my-trips/${booking.id}/pay`}>
          Pay {formatMoney(booking.totalAmount, booking.currency, true)}
        </ButtonLink>
      )}
    </div>
  );
}

/** Every payment attempt of the booking (with refunds) and the invoice once confirmed. */
export function PaymentsCard({ bookingId, status }: { bookingId: string; status: BookingDetails['status'] }) {
  const payments = useQuery({
    queryKey: [...queryKeys.payments.all, 'booking', bookingId],
    queryFn: () => paymentApi.forBooking(bookingId),
  });
  const invoice = useQuery({
    queryKey: [...queryKeys.payments.all, 'invoice', bookingId],
    queryFn: () => paymentApi.invoiceForBooking(bookingId),
    enabled: isConfirmed(status),
    retry: false,
  });
  if (!payments.data || payments.data.length === 0) {
    return null;
  }
  return (
    <DetailCard title="Payments" icon={<CreditCard />}>
      <ul className="mt-3 flex flex-col divide-y divide-slate-100 text-sm" aria-label="Payments of this booking">
        {payments.data.map((payment) => {
          const paymentInfo = paymentStatusInfo[payment.status];
          return (
            <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
              <span className="text-slate-600">
                {formatDateTime(payment.createdAt)}{payment.method ? ` · ${payment.method}` : ''}{payment.provider === 'DEMO' ? ' · demo payment' : ''}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {payment.refundedAmount > 0 && (
                  <span className="text-slate-600">refunded {formatMoney(payment.refundedAmount, payment.currency, true)} of</span>
                )}
                <strong className="tabular-nums text-slate-900">{formatMoney(payment.amount, payment.currency, true)}</strong>
                <Badge tone={paymentInfo.tone}>{paymentInfo.label}</Badge>
              </span>
            </li>
          );
        })}
      </ul>
      {invoice.data && (
        <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
          <ReceiptText className="mr-1.5 inline size-4 align-[-3px] text-role-600" aria-hidden="true" />
          Invoice <strong className="text-slate-900">{invoice.data.invoiceNumber}</strong> · {formatMoney(invoice.data.totalAmount, invoice.data.currency, true)}
          {' '}(taxable {formatMoney(invoice.data.taxableAmount, invoice.data.currency, true)}, tax {formatMoney(invoice.data.taxAmount, invoice.data.currency, true)})
        </p>
      )}
    </DetailCard>
  );
}

/** The booking's status changes, oldest first, as a vertical line of steps (the newest is highlighted). */
export function Timeline({ bookingId, type }: { bookingId: string; type: 'HOTEL' | 'FLIGHT' }) {
  const timeline = useQuery({
    queryKey: queryKeys.bookings.timeline(bookingId),
    queryFn: () => bookingApi.timeline(bookingId),
  });
  if (!timeline.data) {
    return null;
  }
  const last = timeline.data.length - 1;
  return (
    <DetailCard title="Timeline" icon={<History />}>
      <ol className="mt-4 flex flex-col" aria-label="Booking timeline">
        {timeline.data.map((entry, index) => (
          <li key={`${entry.at}-${index}`} className="relative flex gap-3 pb-5 text-sm last:pb-0">
            {index < last && <span aria-hidden="true" className="absolute left-[7px] top-5 h-[calc(100%-1rem)] w-0.5 rounded-full bg-role-100" />}
            <span
              aria-hidden="true"
              className={cn(
                'relative mt-1 size-4 shrink-0 rounded-full border-2',
                index === last ? 'border-role-600 bg-white ring-4 ring-role-100' : 'border-role-600 bg-role-600',
              )}
            />
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{statusLabel(entry.status, type)}</p>
              {entry.reason && <p className="text-slate-600">{entry.reason}</p>}
              <p className="text-xs text-slate-500">{formatDateTime(entry.at)}</p>
            </div>
          </li>
        ))}
      </ol>
    </DetailCard>
  );
}
