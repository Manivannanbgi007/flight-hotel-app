import { Clock, Plane } from 'lucide-react';

import { formatShortDate } from '@/lib/format';
import { arrivalDayOffset, dateOf, formatDuration, layoverMinutes, stopsLabel, timeOf } from './flightFormat';
import type { ItinerarySlice } from './itineraryModel';

/**
 * The flights of a trip as a vertical timeline: "Outbound · Fri, 10 Jan", then each flight with its departure, the
 * airline and duration on the line, the arrival, and the layover between connecting flights. Also used on the booking
 * pages (customer and staff), so it uses the role accent.
 */
export function Itinerary({ slices }: { slices: ItinerarySlice[] }) {
  return (
    <div className="flex flex-col gap-5">
      {slices.map((slice, index) => (
        <section key={`${slice.originCode}-${slice.departureLocal}`} aria-label={index === 0 ? 'Outbound flight' : 'Return flight'}>
          <h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-bold text-slate-900">
            <span className="rounded-full bg-role-50 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-role-700 ring-1 ring-inset ring-role-100">
              {slices.length > 1 ? (index === 0 ? 'Outbound' : 'Return') : 'Flight'}
            </span>
            <span className="font-semibold text-slate-900">{formatShortDate(dateOf(slice.departureLocal))}</span>
            <span className="font-normal text-slate-600">
              {slice.originCity} to {slice.destinationCity} · {formatDuration(slice.durationMinutes)} · {stopsLabel(slice.stops, slice.viaAirport)}
            </span>
          </h3>
          <ol className="mt-3 flex flex-col gap-2">
            {slice.segments.map((segment, segmentIndex) => {
              const previous = slice.segments[segmentIndex - 1];
              const offset = arrivalDayOffset(segment.departureLocal, segment.arrivalLocal);
              return (
                <li key={segment.departureLocal}>
                  {previous && (
                    <div className="mb-2 flex items-center gap-2 pl-1">
                      <Clock className="size-4 shrink-0 text-warning-600" aria-hidden="true" />
                      <p className="rounded-full bg-warning-50 px-3 py-1 text-xs font-medium text-warning-700 ring-1 ring-inset ring-warning-200">
                        Stop at {segment.origin} · {formatDuration(layoverMinutes(previous.arrivalLocal, segment.departureLocal))} layover
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
                    <div aria-hidden="true" className="flex flex-col items-center py-1.5">
                      <span className="size-3 shrink-0 rounded-full border-2 border-role-600 bg-white" />
                      <span className="my-1 w-0 flex-1 border-l-2 border-dashed border-role-200" />
                      <span className="size-3 shrink-0 rounded-full bg-role-600" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex items-baseline gap-3">
                        <p className="w-14 shrink-0 text-lg font-bold text-slate-900">{timeOf(segment.departureLocal)}</p>
                        <p className="text-sm font-semibold text-slate-700">{segment.origin}</p>
                      </div>
                      <div className="ml-14 flex flex-wrap items-center gap-x-3 gap-y-1 pl-3 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1.5">
                          <Plane className="size-3.5 text-role-600" aria-hidden="true" />
                          <span>{segment.airlineName} · {segment.flightNumber}</span>
                        </span>
                        <span>{formatDuration(segment.durationMinutes)}</span>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <p className="w-14 shrink-0 text-lg font-bold text-slate-900">
                          {timeOf(segment.arrivalLocal)}
                        </p>
                        <p className="text-sm font-semibold text-slate-700">
                          {segment.destination}
                          {offset && <sup className="ml-1.5 text-xs font-semibold text-danger-600">{offset}</sup>}
                        </p>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
