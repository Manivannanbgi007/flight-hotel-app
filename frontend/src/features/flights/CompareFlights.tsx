import type { ReactNode } from 'react';
import {
  Armchair, ArrowLeftRight, ArrowRight, BadgeIndianRupee, CircleCheck, Luggage, PlaneLanding, PlaneTakeoff, Route, ShieldCheck,
  Ticket, Timer, Wallet, X, Zap, type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';
import { formatMoney, formatShortDate } from '@/lib/format';
import { AirlineMark } from './FlightBadges';
import { arrivalDayOffset, dateOf, formatDuration, stopsLabel, timeOf } from './flightFormat';
import { highlightsOf, type FlightHighlights } from './resultInsights';
import type { FlightOption } from './types';

export const MAX_COMPARED = 3;

interface Row {
  label: string;
  icon: LucideIcon;
  cell: (option: FlightOption, best: FlightHighlights | undefined) => ReactNode;
}

const ROWS: Row[] = [
  {
    label: 'Departs',
    icon: PlaneTakeoff,
    cell: (o) => <Moment time={timeOf(o.departureLocal)} place={`${o.origin.iataCode} · ${formatShortDate(dateOf(o.departureLocal))}`} />,
  },
  {
    label: 'Arrives',
    icon: PlaneLanding,
    cell: (o) => (
      <Moment
        time={timeOf(o.arrivalLocal)}
        offset={arrivalDayOffset(o.departureLocal, o.arrivalLocal)}
        place={`${o.destination.iataCode} · ${formatShortDate(dateOf(o.arrivalLocal))}`}
      />
    ),
  },
  {
    label: 'Duration',
    icon: Timer,
    cell: (o, best) => (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-slate-900">{formatDuration(o.durationMinutes)}</span>
        {best?.fastest && <BestMark>Shortest</BestMark>}
      </span>
    ),
  },
  {
    label: 'Stops',
    icon: Route,
    cell: (o) => <span className={cn('font-semibold', o.stops === 0 ? 'text-success-700' : 'text-accent-700')}>{stopsLabel(o.stops, o.viaAirport)}</span>,
  },
  {
    label: 'Fare',
    icon: Ticket,
    cell: (o) => (
      <span className="flex flex-col items-start gap-1">
        <span className="font-semibold text-slate-900">{o.fare.name}</span>
        <Badge tone={o.fare.refundable ? 'success' : 'neutral'}>{o.fare.refundable ? 'Refundable' : 'Non-refundable'}</Badge>
      </span>
    ),
  },
  {
    label: 'Baggage',
    icon: Luggage,
    cell: (o) => (
      <span className="flex flex-col">
        <span className="font-semibold text-slate-900">Check-in {o.fare.checkedBaggageKg} kg</span>
        <span className="text-xs text-slate-600">Cabin {o.fare.cabinBaggageKg} kg</span>
      </span>
    ),
  },
  {
    label: 'Seats left',
    icon: Armchair,
    cell: (o) => (o.seatsLeft <= 5
      ? <Badge tone="danger" dot>{`Only ${o.seatsLeft} left`}</Badge>
      : <span className="text-slate-800">{o.seatsLeft} seats</span>),
  },
  {
    label: 'Cancellation',
    icon: ShieldCheck,
    cell: (o) => <span className="text-xs leading-relaxed text-slate-600">{o.fare.cancellationPolicy}</span>,
  },
];

/**
 * Up to three flights side by side in a dialog. "Select" picks one exactly like on the result card.
 *
 * One scroll box for both directions (the dialog's `scroll="body"`): the flight headers stick to its top, the select
 * buttons to its bottom and the row labels to its left, so on a short laptop screen or a phone nothing scrolls out of
 * reach. Still a real table: every value is announced with its row and its flight.
 */
export function CompareFlights({ options, selectLabel, onSelect, onRemove, onClose }: {
  options: FlightOption[];
  selectLabel: string;
  onSelect: (option: FlightOption) => void;
  onRemove: (offerId: string) => void;
  onClose: () => void;
}) {
  const highlights = highlightsOf(options);
  const anyCheapest = [...highlights.values()].some((h) => h.cheapest);
  return (
    <Dialog
      open
      onClose={onClose}
      scroll="body"
      icon={(
        <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
          <ArrowLeftRight className="size-5 text-white" />
        </span>
      )}
      title="Compare flights"
      description={`${options.length} flights side by side. Select one to continue.`}
      className="sm:max-w-5xl"
    >
      {/*
        Phones: fixed column widths (two flights fit next to the labels, a third one is a swipe away) and a wrapper as
        wide as the table, so its padding also shows after the last column. From sm the columns share the dialog width.
      */}
      <div className="w-max min-w-full px-2 sm:w-auto sm:px-4">
        <table className="w-full border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-30 w-[5.25rem] bg-white sm:w-40">
                <span className="sr-only">Detail</span>
              </th>
              {options.map((option, index) => {
                const best = highlights.get(option.offerId);
                return (
                  <th key={option.offerId} scope="col" className="sticky top-0 z-20 bg-white px-1 pb-2 pt-3 align-top font-normal sm:min-w-[12rem] sm:px-1.5 sm:pt-4">
                    <div
                      className="relative w-32 overflow-hidden rounded-2xl bg-gradient-to-b from-slate-50 to-white p-3 ring-1 ring-inset ring-slate-200 animate-pop sm:w-auto sm:p-4"
                      style={{ animationDelay: `${index * 90}ms` }}
                    >
                      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-400 to-brand-600" />
                      <div className="flex items-start gap-2.5">
                        <span aria-hidden="true" className="hidden sm:flex"><AirlineMark code={option.airline.code} name={option.airline.name} size="sm" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold text-slate-900">{option.airline.name}</span>{' '}
                          <span className="block text-xs font-medium text-slate-600">{option.flightNumber}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemove(option.offerId)}
                          aria-label={`Remove ${option.flightNumber} from the comparison`}
                          className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                        >
                          <X className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="mt-2.5 flex min-h-[1.375rem] flex-wrap gap-1">
                        {best?.cheapest && (
                          <Badge tone="success"><BadgeIndianRupee className="size-3.5" aria-hidden="true" /> Cheapest</Badge>
                        )}
                        {best?.fastest && (
                          <Badge tone="brand"><Zap className="size-3.5" aria-hidden="true" /> Fastest</Badge>
                        )}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="stagger-rows">
            {ROWS.map((row, index) => {
              const shade = index % 2 === 0 ? 'bg-slate-50' : 'bg-white';
              return (
                <tr key={row.label}>
                  <th scope="row" className={cn('sticky left-0 z-10 rounded-l-xl px-2.5 py-2.5 align-top font-semibold text-slate-700 sm:px-4', shade)}>
                    <RowLabel icon={row.icon}>{row.label}</RowLabel>
                  </th>
                  {options.map((option, column) => (
                    <td
                      key={option.offerId}
                      className={cn('px-2.5 py-2.5 align-top text-slate-800 sm:px-4', shade, column === options.length - 1 && 'rounded-r-xl')}
                    >
                      <div className="w-[7.25rem] sm:w-auto">{row.cell(option, highlights.get(option.offerId))}</div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {/* Always in view: the price of each flight and its select button. */}
          <tfoot>
            <tr>
              <th scope="row" className="sticky bottom-0 left-0 z-30 border-t border-slate-200 bg-white px-2.5 py-3 align-top font-semibold text-slate-700 sm:px-4 sm:py-4">
                <RowLabel icon={Wallet}>Total price</RowLabel>
              </th>
              {options.map((option) => (
                <td key={option.offerId} className="sticky bottom-0 z-20 border-t border-slate-200 bg-white px-1 py-3 align-top sm:px-1.5 sm:py-4">
                  <div className="flex w-32 flex-col gap-2 px-1.5 sm:w-auto sm:px-2.5">
                    <div>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl">{formatMoney(option.totalPrice, option.currency)}</span>
                        {highlights.get(option.offerId)?.cheapest
                          ? <BestMark>Lowest</BestMark>
                          // Keeps the select buttons in line on phones, where the mark wraps under the price.
                          : anyCheapest && <BestMark placeholder>Lowest</BestMark>}
                      </span>
                      <span className="block text-xs text-slate-600">{formatMoney(option.pricePerAdult, option.currency)} per adult</span>
                    </div>
                    <Button
                      onClick={() => onSelect(option)}
                      className="group/select w-full"
                      aria-label={`${selectLabel} ${option.airline.name} ${option.flightNumber} from the comparison`}
                    >
                      {selectLabel}
                      <ArrowRight className="size-4 transition-transform duration-(--duration-base) ease-out-soft group-hover/select:translate-x-1" aria-hidden="true" />
                    </Button>
                  </div>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </Dialog>
  );
}

/** A row's name with its icon (side by side from sm, the icon above the name on phones, where the column is narrow). */
function RowLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:gap-2.5 sm:text-sm">
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-xs ring-1 ring-slate-200/70">
        <Icon className="size-3.5" />
      </span>
      {children}
    </span>
  );
}

/** A time with its airport and date under it; "+1 day" when the flight lands a day later. */
function Moment({ time, offset, place }: { time: string; offset?: string; place: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-base font-bold tabular-nums text-slate-900">
        {time}
        {offset && <sup className="ml-1 text-xs font-semibold text-danger-600">{offset}</sup>}
      </span>
      <span className="text-xs text-slate-600">{place}</span>
    </span>
  );
}

/** The best value of a row among the compared flights (none when they are all the same). */
function BestMark({ children, placeholder = false }: { children: ReactNode; placeholder?: boolean }) {
  return (
    <span
      aria-hidden={placeholder || undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-xs font-semibold text-success-700 ring-1 ring-inset ring-success-200',
        placeholder ? 'invisible' : 'animate-pop [animation-delay:350ms]',
      )}
    >
      <CircleCheck className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}
