import { useId, useState, type ReactNode } from 'react';
import {
  Moon, Plane, PlaneLanding, PlaneTakeoff, Route, ShieldCheck, SlidersHorizontal, Sun, Sunrise, Sunset, Timer, Wallet,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { checkboxClass, controlClass, radioClass, selectClass } from '@/components/ui/fieldStyles';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { AirlineMark } from './FlightBadges';
import { activeFilterCount, clearedFlightFilters, DAY_PARTS, type FlightFilters as Filters } from './searchParams';
import type { FlightFacets } from './types';

const DURATIONS = [3, 5, 8, 12, 24];

/** Each part of the day with its own picture and colour (decorative: the tile's text says the same). */
const DAY_PART_LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  '00:00': { icon: Moon, tone: 'text-indigo-500' },
  '06:00': { icon: Sunrise, tone: 'text-amber-500' },
  '12:00': { icon: Sun, tone: 'text-orange-500' },
  '18:00': { icon: Sunset, tone: 'text-rose-500' },
};

/**
 * The filter panel. Every change is applied immediately (the URL changes and the results reload), except the price,
 * which is applied with its button so typing does not trigger a search per key.
 */
export function FlightFilters({ filters, facets, onChange }: {
  filters: Filters;
  facets: FlightFacets | undefined;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const nonStop = facets?.stops.find((s) => s.stops === 0)?.count;
  const active = activeFilterCount(filters);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 pb-4">
        <h2 className="flex items-center gap-2.5 text-base font-bold text-slate-900">
          <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
            <SlidersHorizontal className="size-4 text-white" />
          </span>
          Filters{' '}
          {active > 0 && (
            <span key={active} className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold tabular-nums text-white animate-pop">
              {active}{' '}<span className="sr-only">active</span>
            </span>
          )}
        </h2>
        {active > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange(clearedFlightFilters(filters.sort))}>
            Clear all
          </Button>
        )}
      </div>

      <PriceFilter key={String(filters.maxPrice)} filters={filters} facets={facets} onChange={onChange} />

      <Group title="Stops" icon={Route}>
        {[
          { label: 'Any', value: undefined, count: undefined },
          { label: 'Non-stop only', value: 0, count: nonStop },
          { label: 'Up to 1 stop', value: 1, count: undefined },
        ].map((option) => (
          <ChoiceRow key={option.label} name="stops" checked={filters.maxStops === option.value}
            onChange={() => onChange({ maxStops: option.value })} label={option.label} count={option.count} />
        ))}
      </Group>

      <Group title="Fare type" icon={ShieldCheck}>
        {[
          { label: 'Any', value: undefined, count: undefined },
          { label: 'Refundable', value: true, count: facets?.refundable.yes },
          { label: 'Non-refundable', value: false, count: facets?.refundable.no },
        ].map((option) => (
          <ChoiceRow key={option.label} name="fare-type" checked={filters.refundable === option.value}
            onChange={() => onChange({ refundable: option.value })} label={option.label} count={option.count} />
        ))}
      </Group>

      {facets && facets.airlines.length > 0 && (
        <Group title="Airlines" icon={Plane}>
          {facets.airlines.map((airline) => {
            const checked = filters.airlines.includes(airline.code);
            return (
              <label
                key={airline.code}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 ring-1 ring-inset transition-colors duration-(--duration-fast)',
                  checked ? 'bg-brand-50 ring-brand-200' : 'ring-transparent hover:bg-slate-50',
                )}
              >
                <input type="checkbox" className={checkboxClass} checked={checked}
                  onChange={() => onChange({ airlines: toggle(filters.airlines, airline.code) })} />
                <span aria-hidden="true"><AirlineMark code={airline.code} name={airline.name} size="sm" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">{airline.name}</span>{' '}
                  <span className="block text-xs text-slate-600">
                    {airline.count} flight{airline.count === 1 ? '' : 's'} · from {formatMoney(airline.minPrice)}
                  </span>
                </span>
              </label>
            );
          })}
        </Group>
      )}

      <Group title="Departure time" icon={PlaneTakeoff}>
        <DayParts after={filters.departAfter} before={filters.departBefore}
          onPick={(after, before) => onChange({ departAfter: after, departBefore: before })} />
      </Group>

      <Group title="Arrival time" icon={PlaneLanding}>
        <DayParts after={filters.arriveAfter} before={filters.arriveBefore}
          onPick={(after, before) => onChange({ arriveAfter: after, arriveBefore: before })} />
      </Group>

      <Group title="Journey duration" icon={Timer}>
        <select aria-label="Longest journey" className={selectClass()}
          value={filters.maxDurationMinutes ?? ''} onChange={(e) => onChange({ maxDurationMinutes: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">Any duration</option>
          {DURATIONS.map((hours) => <option key={hours} value={hours * 60}>Up to {hours} hours</option>)}
        </select>
      </Group>
    </div>
  );
}

/** A radio option drawn as a row; the count (from the search facets) is a small pill on the right. */
function ChoiceRow({ name, label, count, checked, onChange }: {
  name: string;
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm ring-1 ring-inset transition-colors duration-(--duration-fast)',
        checked ? 'bg-brand-50 font-semibold text-brand-800 ring-brand-200' : 'text-slate-700 ring-transparent hover:bg-slate-50',
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className={radioClass} />
      <span className="flex-1">{label}</span>{' '}
      {count !== undefined && (
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 ring-1 ring-inset ring-slate-200">
          {count}{' '}<span className="sr-only">flights</span>
        </span>
      )}
    </label>
  );
}

/**
 * Four tiles for the parts of the day (toggle buttons: pressing the chosen one again goes back to "any time"). The
 * fieldset around them names the group ("Departure time").
 */
function DayParts({ after, before, onPick }: { after: string; before: string; onPick: (after: string, before: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {DAY_PARTS.map((part) => {
        const on = part.after === after && part.before === before;
        const { icon: Icon, tone } = DAY_PART_LOOK[part.after] ?? { icon: Sun, tone: 'text-slate-500' };
        return (
          <button
            key={part.label}
            type="button"
            aria-pressed={on}
            onClick={() => (on ? onPick('', '') : onPick(part.after, part.before))}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-xl px-2 py-2.5 text-center transition-[background-color,box-shadow] duration-(--duration-fast)',
              on ? 'bg-brand-50 text-brand-800 shadow-sm ring-2 ring-inset ring-brand-500' : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:ring-slate-300',
            )}
          >
            <span aria-hidden="true" className={cn('mb-0.5 flex', on ? 'text-brand-600' : tone)}>
              <Icon className={cn('size-5 text-current', on && 'animate-pop')} />
            </span>
            {/* The name is the visible text: "Morning 06:00–12:00". */}
            <span className="text-sm font-semibold">{part.name}</span>{' '}
            <span className="text-xs tabular-nums text-slate-600">{part.hours}</span>
          </button>
        );
      })}
    </div>
  );
}

function PriceFilter({ filters, facets, onChange }: { filters: Filters; facets: FlightFacets | undefined; onChange: (patch: Partial<Filters>) => void }) {
  const [max, setMax] = useState(filters.maxPrice === undefined ? '' : String(filters.maxPrice));
  const inputId = useId();
  const apply = () => {
    const value = Number(max);
    onChange({ maxPrice: max.trim() !== '' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined });
  };
  return (
    <Group title="Price" icon={Wallet}>
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">Maximum price</label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-slate-500">₹</span>
          <input
            id={inputId}
            inputMode="numeric"
            value={max}
            onChange={(event) => setMax(event.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                apply();
              }
            }}
            placeholder={facets ? `up to ${formatMoney(facets.maxPrice).replace('₹', '')}` : 'Any'}
            className={cn(controlClass(false), 'pl-7')}
          />
        </div>
        <Button variant="secondary" onClick={apply}>Apply price</Button>
      </div>
      {facets && (
        <p className="text-xs text-slate-600">
          Fares on this route: {formatMoney(facets.minPrice)} – {formatMoney(facets.maxPrice)}
        </p>
      )}
    </Group>
  );
}

function Group({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5 border-t border-slate-100 py-4 last:pb-0">
      <legend className="float-left mb-2 flex w-full items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
        <Icon className="size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
        {title}
      </legend>
      {children}
    </fieldset>
  );
}
