import { ArrowRight, BadgeIndianRupee, Luggage, Plane, ShieldCheck, Ticket, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { checkboxClass } from '@/components/ui/fieldStyles';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { AirlineMark, DemoInventoryBadge } from './FlightBadges';
import { arrivalDayOffset, baggageLabel, formatDuration, stopsLabel, timeOf } from './flightFormat';
import type { FlightHighlights } from './resultInsights';
import type { Airport, FlightOption } from './types';

/**
 * One flight with its fare: the airline, a departure → arrival timeline (on hover the plane glides along it), the fare
 * facts as chips, and a price panel with the total and the select button. "Cheapest" and "Fastest" tags come from
 * the whole list (resultInsights).
 */
export function FlightOptionCard({ option, highlights, selectLabel, onSelect, compared, compareDisabled, onToggleCompare, busy }: {
  option: FlightOption;
  highlights?: FlightHighlights;
  selectLabel: string;
  onSelect: () => void;
  compared: boolean;
  compareDisabled: boolean;
  onToggleCompare: () => void;
  busy?: boolean;
}) {
  const offset = arrivalDayOffset(option.departureLocal, option.arrivalLocal);
  const fewSeats = option.seatsLeft <= 5;
  return (
    <li>
      <Card
        className={cn(
          'group overflow-hidden hover-lift hover:border-brand-200',
          compared && 'border-brand-300 ring-2 ring-brand-100',
        )}
      >
        <div className="grid md:grid-cols-[minmax(0,1fr)_13.5rem]">
          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 items-center gap-3">
                <AirlineMark code={option.airline.code} name={option.airline.name} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{option.airline.name}</p>
                  <p className="text-xs text-slate-500">{option.flightNumber}</p>
                </div>
              </div>
              {(highlights?.cheapest || highlights?.fastest) && (
                <div className="flex flex-wrap gap-1.5">
                  {highlights.cheapest && (
                    <Badge tone="success" className="animate-pop [animation-delay:200ms]">
                      <BadgeIndianRupee className="size-3.5" aria-hidden="true" /> Cheapest
                    </Badge>
                  )}
                  {highlights.fastest && (
                    <Badge tone="brand" className="animate-pop [animation-delay:300ms]">
                      <Zap className="size-3.5" aria-hidden="true" /> Fastest
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-5">
              <TimelineEnd time={timeOf(option.departureLocal)} airport={option.origin} />
              <RouteLine minutes={option.durationMinutes} stops={option.stops} via={option.viaAirport} />
              <TimelineEnd time={timeOf(option.arrivalLocal)} airport={option.destination} offset={offset} align="right" />
            </div>

            <ul aria-label="Fare" className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <li>
                <Badge tone={option.fare.refundable ? 'success' : 'neutral'}>
                  <Ticket className="size-3.5" aria-hidden="true" />
                  <span>{option.fare.name} · {option.fare.refundable ? 'Refundable' : 'Non-refundable'}</span>
                </Badge>
              </li>
              <li className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-0.5 font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                <Luggage className="size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                <span>{baggageLabel(option.fare.checkedBaggageKg, option.fare.cabinBaggageKg)}</span>
              </li>
              {fewSeats && (
                <li>
                  <Badge tone="danger" dot>{`Only ${option.seatsLeft} seat${option.seatsLeft === 1 ? '' : 's'} left`}</Badge>
                </li>
              )}
              {option.demo && <li><DemoInventoryBadge /></li>}
            </ul>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 p-4 sm:px-5 md:flex-col md:items-stretch md:justify-center md:border-l md:border-t-0">
            <div className="md:text-right">
              <p className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-[1.75rem]">{formatMoney(option.totalPrice, option.currency)}</p>
              <p className="text-xs text-slate-600">{formatMoney(option.pricePerAdult, option.currency)} per adult</p>
              <p className="text-xs text-slate-500">Taxes and fees included</p>
            </div>
            <Button onClick={onSelect} loading={busy} className="group/select min-w-32 md:w-full" aria-label={`${selectLabel} ${option.airline.name} ${option.flightNumber}`}>
              {selectLabel}
              {!busy && <ArrowRight className="size-4 transition-transform duration-(--duration-base) ease-out-soft group-hover/select:translate-x-1" aria-hidden="true" />}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600 sm:px-5">
          <p className="flex min-w-0 flex-1 basis-64 items-start gap-1.5">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
            <span>{option.fare.cancellationPolicy}</span>
          </p>
          <label
            className={cn(
              'ml-auto inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50',
              compareDisabled && !compared && 'cursor-not-allowed opacity-50',
            )}
          >
            <input
              type="checkbox"
              className={checkboxClass}
              checked={compared}
              disabled={compareDisabled && !compared}
              onChange={onToggleCompare}
              aria-label={`Compare ${option.airline.name} ${option.flightNumber}`}
            />
            Compare
          </label>
        </div>
      </Card>
    </li>
  );
}

function TimelineEnd({ time, airport, offset, align = 'left' }: { time: string; airport: Airport; offset?: string; align?: 'left' | 'right' }) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <p className="whitespace-nowrap text-2xl font-bold tracking-tight tabular-nums text-slate-900">
        {time}
        {offset && <sup className="ml-1 text-xs font-semibold text-danger-600">{offset}</sup>}
      </p>
      <p className="mt-0.5 text-xs text-slate-600">
        <span className="font-bold text-slate-800">{airport.iataCode}</span>
        <span className="hidden sm:inline"> · {airport.city}</span>
      </p>
    </div>
  );
}

/**
 * Duration, a dashed line with a plane and the stops. The line's filled part ends at the plane; on hover of the card
 * both move on to the destination (transforms only; under reduced motion they simply jump).
 */
function RouteLine({ minutes, stops, via }: { minutes: number; stops: number; via: string | null }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-xs">
      <span className="font-semibold text-slate-700">{formatDuration(minutes)}</span>
      <span aria-hidden="true" className="relative flex h-6 w-full items-center">
        <span className="absolute inset-x-1 h-0.5 rounded-full bg-[repeating-linear-gradient(90deg,var(--color-slate-300)_0_5px,transparent_5px_9px)]" />
        <span className="absolute inset-x-1 h-0.5 origin-left scale-x-[0.32] rounded-full bg-gradient-to-r from-brand-300 to-brand-600 transition-transform duration-(--duration-slow) ease-out-soft group-hover:scale-x-[0.94]" />
        <span className="absolute left-0 size-2.5 rounded-full border-2 border-brand-600 bg-white" />
        <span className="absolute right-0 size-2.5 rounded-full bg-brand-600" />
        {Array.from({ length: stops }, (_, index) => (
          <span
            key={index}
            className="absolute size-2.5 -translate-x-1/2 rounded-full bg-accent-500 ring-2 ring-white"
            style={{ left: `${((index + 1) / (stops + 1)) * 100}%` }}
          />
        ))}
        {/* A box as wide as the line, its right edge where the plane is: it slides from 32% to 94% on hover. */}
        <span className="absolute inset-x-1 flex -translate-x-[68%] justify-end transition-transform duration-(--duration-slow) ease-out-soft group-hover:-translate-x-[6%]">
          <span className="flex size-6 translate-x-1/2 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-brand-100">
            <Plane className="size-3.5 rotate-45 fill-brand-100 text-brand-600" />
          </span>
        </span>
      </span>
      <span className={cn('whitespace-nowrap', stops === 0 ? 'font-semibold text-success-700' : 'font-semibold text-accent-700')}>
        {stopsLabel(stops, via)}
      </span>
    </div>
  );
}
