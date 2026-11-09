import type { ReactNode } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowRight, BedDouble, CalendarCheck2, Plane } from 'lucide-react';

import { BoardingPassIllustration, GlobeIllustration, HotelIllustration } from '@/components/illustrations';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { CABIN_LABELS, type Cabin } from '@/features/flights/types';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney } from '@/lib/format';
import type { NextTrip } from './summaryApi';
import { countdownOf } from './tripCountdown';

/** Airport local time "2026-11-15T05:10" → "Sun, 15 Nov 2026, 05:10". */
function localDateTime(local: string): string {
  return format(parseISO(local), 'EEE, d MMM yyyy, HH:mm');
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The confirmed trip that starts first, as a boarding-pass card: details on the left, the countdown stub on the right. */
export function NextTripCard({ trip }: { trip: NextTrip }) {
  const countdown = countdownOf(trip);
  const facts = trip.flight ? flightFacts(trip) : hotelFacts(trip);
  const title = trip.flight
    ? `${trip.flight.originCity ?? trip.flight.origin} to ${trip.flight.destinationCity ?? trip.flight.destination}`
    : trip.hotel?.hotelName ?? trip.title ?? 'Your trip';
  const subtitle = trip.flight
    ? [trip.flight.airlineName, trip.flight.flightNumber, CABIN_LABELS[trip.flight.cabin as Cabin] ?? trip.flight.cabin, trip.flight.stops === 0 ? 'Non-stop' : plural(trip.flight.stops, 'stop')]
      .filter(Boolean).join(' · ')
    : [trip.hotel?.city, trip.hotel?.roomTypeName].filter(Boolean).join(' · ');

  return (
    <section
      aria-labelledby="next-trip-title"
      className="relative grid overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-lg animate-fade-up md:grid-cols-[minmax(0,1fr)_15rem]"
    >
      <div className="relative order-2 flex min-w-0 flex-col gap-5 p-5 sm:p-7 md:order-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="next-trip-title" className="text-xs font-bold uppercase tracking-wider text-brand-700">Your next trip</h2>
          <Badge tone="success" dot>Confirmed</Badge>
        </div>
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
            {trip.type === 'FLIGHT' ? <Plane className="size-6" /> : <BedDouble className="size-6" />}
          </span>
          <div className="min-w-0">
            <p className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              <span className="sr-only">{trip.type === 'FLIGHT' ? 'Flight: ' : 'Hotel stay: '}</span>
              {title}
            </p>
            {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs font-semibold text-slate-500">{label}</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-dashed border-slate-200 pt-4">
          <ButtonLink to={`/my-trips/${trip.bookingId}`} aria-label={`View booking ${trip.reference}`}>
            View booking <ArrowRight className="size-4" aria-hidden="true" />
          </ButtonLink>
          <span className="text-sm text-slate-600">
            Reference <span className="font-semibold text-slate-900">{trip.reference}</span>
            {trip.totalAmount > 0 && <> · {formatMoney(trip.totalAmount, trip.currency, true)}</>}
          </span>
        </div>
      </div>

      {/* The ticket stub: countdown on the dark brand panel (white text on brand-800: 10:1). */}
      <div className="relative order-1 flex items-center gap-4 overflow-hidden bg-brand-800 px-5 py-4 text-white md:order-2 md:flex-col md:justify-center md:px-6 md:py-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-brand-500/30 blur-2xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-12 -left-8 size-36 rounded-full bg-accent-500/20 blur-2xl" />
        {/* Perforation between the card and the stub (decorative). */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-4 left-0 hidden border-l-2 border-dashed border-white/25 md:block" />
        <div className="relative hidden w-36 md:block" aria-hidden="true">
          <div className="animate-float">
            {trip.type === 'FLIGHT' ? <BoardingPassIllustration className="w-36" /> : <HotelIllustration className="w-36" />}
          </div>
        </div>
        <p className="relative flex items-baseline gap-2 md:flex-col md:items-center md:gap-0 md:text-center">
          <span className="sr-only">{countdown.sentence}</span>
          <span aria-hidden="true" className="text-4xl font-extrabold tracking-tight md:text-5xl">{countdown.big}</span>
          <span aria-hidden="true" className="text-sm font-semibold text-brand-100">{countdown.small}</span>
        </p>
        <p className="relative ml-auto flex items-center gap-1.5 text-xs font-medium text-brand-100 md:ml-0">
          <CalendarCheck2 className="size-4" aria-hidden="true" />
          {formatDate(trip.startDate)}
        </p>
      </div>
    </section>
  );
}

function flightFacts(trip: NextTrip): [string, ReactNode][] {
  const flight = trip.flight!;
  const facts: [string, ReactNode][] = [
    ['Departs', `${localDateTime(flight.departureLocal)} · ${flight.origin}`],
  ];
  if (flight.arrivalLocal) facts.push(['Arrives', `${localDateTime(flight.arrivalLocal)} · ${flight.destination}`]);
  if (flight.returnDepartureLocal) facts.push(['Return flight', localDateTime(flight.returnDepartureLocal)]);
  if (flight.passengers) facts.push(['Passengers', plural(flight.passengers, 'passenger')]);
  if (flight.pnr) facts.push(['Airline reference (PNR)', flight.pnr]);
  return facts;
}

function hotelFacts(trip: NextTrip): [string, ReactNode][] {
  const hotel = trip.hotel!;
  const facts: [string, ReactNode][] = [
    ['Check-in', `${formatDate(hotel.checkIn)}${hotel.checkInTime ? `, from ${hotel.checkInTime}` : ''}`],
    ['Check-out', `${formatDate(hotel.checkOut)}${hotel.checkOutTime ? `, until ${hotel.checkOutTime}` : ''}`],
  ];
  const stay = [
    hotel.nights ? plural(hotel.nights, 'night') : null,
    hotel.rooms ? plural(hotel.rooms, 'room') : null,
    hotel.guests ? plural(hotel.guests, 'guest') : null,
  ].filter(Boolean).join(' · ');
  if (stay) facts.push(['Stay', stay]);
  if (hotel.confirmationNumber) facts.push(['Hotel confirmation no.', hotel.confirmationNumber]);
  if (hotel.address) facts.push(['Address', [hotel.address, hotel.city].filter(Boolean).join(', ')]);
  return facts;
}

/** No confirmed trip ahead (the customer has booked before). */
export function NoNextTrip() {
  return (
    <section
      aria-labelledby="next-trip-title"
      className="relative flex flex-col items-center gap-5 overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-6 text-center shadow-card animate-fade-up sm:flex-row sm:p-8 sm:text-left"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 bg-gradient-mesh opacity-60" />
      <div className="relative w-32 shrink-0 sm:w-40" aria-hidden="true">
        <GlobeIllustration className="w-32 sm:w-40" />
      </div>
      <div className="relative min-w-0">
        <h2 id="next-trip-title" className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">No trips coming up</h2>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-600">
          Where to next? Find a flight or a stay, and your next trip will show up here with a countdown.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
          <ButtonLink to="/flights"><Plane className="size-4" aria-hidden="true" />Search flights</ButtonLink>
          <ButtonLink to="/hotels" variant="secondary"><BedDouble className="size-4" aria-hidden="true" />Search hotels</ButtonLink>
        </div>
      </div>
    </section>
  );
}

/** Placeholder in the card's shape while the summary loads. */
export function NextTripSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('grid overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-card md:grid-cols-[minmax(0,1fr)_15rem]', className)}>
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-3 w-28" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-9" />)}
        </div>
        <Skeleton className="h-10 w-36" />
      </div>
      <Skeleton className="hidden h-full min-h-48 rounded-none md:block" />
    </div>
  );
}

