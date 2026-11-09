import { Luggage, Plane, ShieldCheck, Ticket, Users } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { baggageLabel, dateOf, describePassengers, timeOf } from '@/features/flights/flightFormat';
import { Itinerary } from '@/features/flights/Itinerary';
import { itineraryOfBooking } from '@/features/flights/itineraryModel';
import { CABIN_LABELS, type Cabin } from '@/features/flights/types';
import { formatDate, formatShortDate } from '@/lib/format';
import { DetailCard } from './BookingUi';
import { isConfirmed } from './status';
import type { BookingStatus, FlightTrip } from './types';

/** Route and times, one line per direction: used on the payment page and in lists. */
export function FlightSummaryLines({ flight }: { flight: FlightTrip }) {
  return (
    <>
      <p className="text-sm text-slate-600">
        {flight.tripType === 'ROUND_TRIP' ? 'Round trip' : 'One way'} · {CABIN_LABELS[flight.cabin as Cabin] ?? flight.cabin} · {flight.fareName}
      </p>
      {flight.slices.map((slice) => (
        <p key={slice.departureLocal} className="mt-1 text-sm font-medium text-slate-800">
          {slice.origin} to {slice.destination} · {formatShortDate(dateOf(slice.departureLocal))} {timeOf(slice.departureLocal)}
        </p>
      ))}
      <p className="mt-1 text-sm text-slate-700">{describePassengers(flight)}</p>
    </>
  );
}

/** The flight part of Booking Details: itinerary, PNR and tickets (only once issued), passengers, baggage, rules. */
export function FlightBookingSection({ flight, status }: { flight: FlightTrip; status: BookingStatus }) {
  const issued = isConfirmed(status);
  return (
    <>
      <DetailCard title="Your flights" icon={<Plane />}>
        <p className="mt-2 text-sm text-slate-600">
          {flight.tripType === 'ROUND_TRIP' ? 'Round trip' : 'One way'} · {CABIN_LABELS[flight.cabin as Cabin] ?? flight.cabin} · {flight.fareName} ·{' '}
          {flight.refundable ? 'Refundable' : 'Non-refundable'}
        </p>
        {/* Golden rule 3: no airline reference before the airline issued the booking. */}
        {issued && flight.pnr && (
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-role-50/70 px-3 py-2.5 text-sm text-slate-700 ring-1 ring-inset ring-role-100">
            Airline booking reference (PNR): <strong className="text-base tracking-wide text-slate-900">{flight.pnr}</strong>
          </p>
        )}
        <div className="mt-4"><Itinerary slices={flight.slices.map(itineraryOfBooking)} /></div>
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-600">
          <Luggage className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
          <span>{baggageLabel(flight.checkedBaggageKg, flight.cabinBaggageKg)} per passenger</span>
        </p>
      </DetailCard>

      <DetailCard title="Passengers" icon={<Users />}>
        <ul className="mt-3 flex flex-col divide-y divide-slate-100 text-sm text-slate-700" aria-label="Passengers of this booking">
          {flight.passengers.map((p) => (
            <li key={p.passengerNo} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
              <span className="min-w-0 font-semibold text-slate-900">
                {p.firstName} {p.lastName}
                <span className="font-normal text-slate-500"> · {p.passengerType.toLowerCase()}{p.dateOfBirth ? ` · born ${formatDate(p.dateOfBirth)}` : ''}{p.passportLast4 ? ` · passport ••••${p.passportLast4}` : ''}</span>
              </span>
              {issued && p.ticketNumber && (
                <Badge tone="role" className="gap-1.5"><Ticket className="size-3.5" aria-hidden="true" /> Ticket {p.ticketNumber}</Badge>
              )}
            </li>
          ))}
        </ul>
      </DetailCard>

      {flight.cancellationPolicy && (
        <DetailCard title="Cancellation" icon={<ShieldCheck />}>
          <p className="mt-3 text-sm text-slate-700">{flight.cancellationPolicy}</p>
        </DetailCard>
      )}
    </>
  );
}
