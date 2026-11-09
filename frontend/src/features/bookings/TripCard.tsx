import { Link } from 'react-router';
import { format, parseISO } from 'date-fns';
import { ArrowRight, BedDouble, CalendarDays, CreditCard, LifeBuoy, MapPin, Plane, Users } from 'lucide-react';

import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DocumentDownloadButton } from '@/features/documents/DocumentDownloadButton';
import { DemoInventoryBadge } from '@/features/flights/FlightBadges';
import { DemoBadge } from '@/features/hotels/HotelBadges';
import { useHotelPhoto } from '@/features/hotels/useHotelPhoto';
import { writeReviewPath } from '@/features/reviews/useReviews';
import { cn } from '@/lib/cn';
import { formatMoney, formatShortDate } from '@/lib/format';
import { dangerLinkClass } from './actionStyles';
import { BookingStatusBadge } from './BookingParts';
import { statusInfo, type StatusTone } from './status';
import type { BookingSummary, FlightBrief, FlightSliceInfo, HotelBrief } from './types';

/** The colour of a card's left edge says at a glance how the trip is doing (green fine, orange waiting, red failed). */
const EDGE: Record<StatusTone, string> = {
  success: 'border-l-success-500',
  warning: 'border-l-warning-500',
  danger: 'border-l-danger-500',
  info: 'border-l-info-500',
  neutral: 'border-l-slate-300',
};

const clock = (local: string) => format(parseISO(local), 'HH:mm');
const day = (local: string) => formatShortDate(local.slice(0, 10));

function tripDates(trip: BookingSummary): string | null {
  if (!trip.startDate || !trip.endDate) return null;
  return trip.endDate === trip.startDate
    ? formatShortDate(trip.startDate)
    : `${formatShortDate(trip.startDate)} to ${formatShortDate(trip.endDate)}`;
}

/** One trip of My Trips: what it is (hotel photo or flight route), its status, and the actions the backend allows. */
export function TripCard({ trip, canReview }: { trip: BookingSummary; canReview: boolean }) {
  const payable = trip.status === 'PENDING_PAYMENT';
  const tone = statusInfo[trip.status]?.tone ?? 'neutral';
  const title = trip.title ?? (trip.type === 'FLIGHT' ? 'Flight booking' : 'Hotel booking');
  return (
    <li>
      <Card className={cn('overflow-hidden border-l-4 transition-[box-shadow,transform] duration-(--duration-base) hover:-translate-y-0.5 hover:shadow-lg', EDGE[tone])}>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
          {trip.type === 'HOTEL'
            ? <HotelThumb slug={trip.stay?.hotelSlug ?? null} name={trip.stay?.hotelName ?? title} />
            : <FlightTile />}

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/my-trips/${trip.id}`} className="rounded-md text-lg font-bold tracking-tight text-slate-900 transition-colors hover:text-role-700">
                    {title}
                  </Link>
                  {trip.demo && (trip.type === 'FLIGHT' ? <DemoInventoryBadge /> : <DemoBadge />)}
                </div>
                <p className="mt-0.5 text-xs font-medium text-slate-500">Reference {trip.reference}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {trip.totalAmount > 0 && (
                  <p className="text-lg font-bold tabular-nums text-slate-900">{formatMoney(trip.totalAmount, trip.currency, true)}</p>
                )}
                <BookingStatusBadge status={trip.status} type={trip.type} paymentStatus={trip.paymentStatus} />
              </div>
            </div>

            {trip.type === 'FLIGHT' && trip.flight && trip.flight.slices.length > 0
              ? <FlightFacts flight={trip.flight} />
              : <HotelFacts trip={trip} stay={trip.stay ?? null} />}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
          {payable && <ButtonLink to={`/my-trips/${trip.id}/pay`} size="sm">Pay now</ButtonLink>}
          <ButtonLink to={`/my-trips/${trip.id}`} variant="secondary" size="sm">View details</ButtonLink>
          {(trip.paymentStatus !== 'UNPAID') && (
            <ButtonLink to={`/account/payments?q=${encodeURIComponent(trip.reference)}`} variant="secondary" size="sm"
              aria-label={`Payment details of ${trip.reference}`}>
              <CreditCard className="size-4" aria-hidden="true" />Payments
            </ButtonLink>
          )}
          {canReview && (
            <ButtonLink to={writeReviewPath(trip.id)} variant="secondary" size="sm" aria-label={`Write a review of ${trip.title ?? 'this stay'}`}>
              Write a review
            </ButtonLink>
          )}
          {(trip.status === 'CONFIRMED' || trip.status === 'COMPLETED') && (
            <DocumentDownloadButton
              bookingId={trip.id}
              type="BOOKING_CONFIRMATION"
              label="Download confirmation"
              accessibleName={`Download confirmation ${trip.reference}`}
              notReadyText="Your confirmation is not ready yet. It appears a few seconds after the booking is confirmed."
            />
          )}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <ButtonLink to={`/account/support/new?bookingId=${trip.id}`} variant="ghost" size="sm" aria-label={`Contact support about ${trip.reference}`}>
              <LifeBuoy className="size-4" aria-hidden="true" />Help
            </ButtonLink>
            {trip.canCancel && (
              <Link to={`/my-trips/${trip.id}/cancel`} aria-label={`Cancel booking ${trip.reference}`} className={dangerLinkClass('sm')}>
                Cancel
              </Link>
            )}
          </span>
        </div>
      </Card>
    </li>
  );
}

/** The hotel's first photo (one cached request per hotel); a soft tile with an icon until it arrives or when it has none. */
function HotelThumb({ slug, name }: { slug: string | null; name: string }) {
  const image = useHotelPhoto(slug);
  return (
    <div className="relative h-32 w-full shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 ring-1 ring-inset ring-brand-100 sm:h-auto sm:w-40">
      {image ? (
        <img src={image.thumbUrl || image.url} alt={`${name}`} loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-brand-500"><BedDouble role="img" aria-label="Hotel" className="size-9" /></span>
      )}
    </div>
  );
}

function FlightTile() {
  return (
    <div className="flex h-20 w-full shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-info-50 to-brand-100 text-brand-600 ring-1 ring-inset ring-brand-100 sm:h-auto sm:w-40">
      <Plane role="img" aria-label="Flight" className="size-9 -rotate-12" />
    </div>
  );
}

function HotelFacts({ trip, stay }: { trip: BookingSummary; stay: HotelBrief | null }) {
  const dates = tripDates(trip);
  const guests = stay ? [
    stay.adults ? `${stay.adults} ${stay.adults === 1 ? 'adult' : 'adults'}` : null,
    stay.children ? `${stay.children} ${stay.children === 1 ? 'child' : 'children'}` : null,
  ].filter(Boolean).join(', ') : '';
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-sm text-slate-600 sm:grid-cols-2">
      {(stay?.city ?? trip.destination) && (
        <div className="flex items-center gap-1.5"><dt className="sr-only">Location</dt><MapPin className="size-4 shrink-0 text-slate-500" aria-hidden="true" /><dd>{stay?.city ?? trip.destination}</dd></div>
      )}
      {dates && (
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Dates</dt><CalendarDays className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
          <dd>{dates}{stay?.nights ? ` · ${stay.nights} ${stay.nights === 1 ? 'night' : 'nights'}` : ''}</dd>
        </div>
      )}
      {(guests || stay?.rooms) && (
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Guests</dt><Users className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
          <dd>{[guests, stay?.rooms ? `${stay.rooms} ${stay.rooms === 1 ? 'room' : 'rooms'}` : ''].filter(Boolean).join(' · ')}</dd>
        </div>
      )}
      {stay?.roomTypeName && (
        <div className="flex items-center gap-1.5"><dt className="sr-only">Room</dt><BedDouble className="size-4 shrink-0 text-slate-500" aria-hidden="true" /><dd>{stay.roomTypeName}</dd></div>
      )}
    </dl>
  );
}

/** The route as a small timeline: departure, a dotted line with the airline and stops, arrival. */
function FlightFacts({ flight }: { flight: FlightBrief }) {
  const travellers = flight.passengerNames.length;
  return (
    <div className="flex flex-col gap-2.5">
      {flight.slices.map((slice, index) => <SliceRoute key={`${slice.origin}-${slice.departureLocal}-${index}`} slice={slice} label={flight.slices.length > 1 ? (index === 0 ? 'Outbound' : 'Return') : null} />)}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
        <span className="flex items-center gap-1.5">
          <Users className="size-4 text-slate-500" aria-hidden="true" />
          {travellers > 0 ? flight.passengerNames.join(', ') : `${flight.adults + flight.children + flight.infants} travellers`}
        </span>
        <span className="capitalize">{flight.cabin.toLowerCase().replace('_', ' ')}</span>
      </p>
    </div>
  );
}

function SliceRoute({ slice, label }: { slice: FlightSliceInfo; label: string | null }) {
  const first = slice.segments[0];
  const airline = first ? `${first.airlineName} ${first.flightNumber}` : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200/70">
      {label && <span className="w-full text-xs font-bold uppercase tracking-wider text-slate-500 sm:w-auto">{label}</span>}
      <div className="text-center sm:text-left">
        <p className="text-lg font-bold leading-none tabular-nums text-slate-900">{clock(slice.departureLocal)}</p>
        <p className="mt-1 text-xs font-semibold text-slate-600">{slice.origin} · {day(slice.departureLocal)}</p>
      </div>
      <div className="flex min-w-16 flex-1 flex-col items-center gap-0.5 text-xs text-slate-500" aria-hidden="true">
        <span className="flex w-full items-center gap-1"><span className="h-px flex-1 border-t border-dashed border-slate-400" /><Plane className="size-3.5 text-brand-600" /><span className="h-px flex-1 border-t border-dashed border-slate-400" /></span>
        <span>{slice.stops === 0 ? 'Non-stop' : `${slice.stops} ${slice.stops === 1 ? 'stop' : 'stops'}`}</span>
      </div>
      <div className="text-center sm:text-left">
        <p className="text-lg font-bold leading-none tabular-nums text-slate-900">{clock(slice.arrivalLocal)}</p>
        <p className="mt-1 text-xs font-semibold text-slate-600">{slice.destination} · {day(slice.arrivalLocal)}</p>
      </div>
      <span className="sr-only">{slice.originCity} to {slice.destinationCity}</span>
      {airline && <p className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-600"><ArrowRight className="size-3" aria-hidden="true" />{airline}</p>}
    </div>
  );
}
