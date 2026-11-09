import { useState } from 'react';
import { ArrowLeftRight, PlaneLanding, PlaneTakeoff, Search } from 'lucide-react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { DateField } from '@/components/ui/DateField';
import { SelectField } from '@/components/ui/Field';
import { todayIso } from '@/features/account/schemas';
import { recordFlightSearch } from '@/features/home/recentSearches';
import { cn } from '@/lib/cn';
import { AirportField } from './AirportField';
import { MAX_SEATS, searchProblem, type FlightSearch } from './searchParams';
import { CABIN_LABELS, type Airport, type Cabin } from './types';

const range = (from: number, to: number) => Array.from({ length: Math.max(to - from + 1, 0) }, (_, i) => from + i);

const TRIP_TYPES = [{ label: 'One way', value: false }, { label: 'Round trip', value: true }];

/**
 * From, to, dates, travellers and cabin. Used on the home page, the flights page and above the results. Calls
 * {@code onSearch} only with a search the API will accept (same rules as flight-service).
 */
export function FlightSearchForm({ search, onSearch, compact = false }: {
  search: FlightSearch;
  onSearch: (search: FlightSearch) => void;
  compact?: boolean;
}) {
  const [form, setForm] = useState<FlightSearch>(search);
  const [problem, setProblem] = useState<string | null>(null);
  const [round, setRound] = useState(search.returnDate !== '');
  /** City of each airport chosen from the suggestions (for the recent searches list). */
  const [cities, setCities] = useState<Record<string, string>>({});
  const rememberCity = (airport?: Airport) => {
    if (airport) setCities((known) => ({ ...known, [airport.iataCode]: airport.city }));
  };
  const patch = (changes: Partial<FlightSearch>) => {
    setForm((current) => ({ ...current, ...changes }));
    setProblem(null);
  };

  const setTripType = (isRound: boolean) => {
    setRound(isRound);
    patch({ returnDate: isRound ? (form.returnDate || form.departureDate) : '' });
  };

  const setAdults = (adults: number) => {
    const children = Math.min(form.children, MAX_SEATS - adults);
    patch({ adults, children, infants: Math.min(form.infants, adults) });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const issue = searchProblem(form);
    if (issue) {
      setProblem(issue);
      return;
    }
    // Remembered on this device for "Recently viewed searches".
    recordFlightSearch(form, { origin: cities[form.origin], destination: cities[form.destination] });
    onSearch(form);
  };

  return (
    <form onSubmit={submit} noValidate role="search" aria-label="Search flights" className={cn('flex flex-col', compact ? 'gap-3' : 'gap-4')}>
      {/* Trip type: real radio buttons, drawn as a segmented control. */}
      <fieldset className="inline-flex w-fit max-w-full gap-1 rounded-full bg-slate-100 p-1 ring-1 ring-inset ring-slate-200/70">
        <legend className="sr-only">Trip type</legend>
        {TRIP_TYPES.map((option) => (
          <label
            key={option.label}
            className={cn(
              'relative inline-flex cursor-pointer items-center rounded-full px-4 py-1.5 text-sm font-semibold transition-colors duration-(--duration-fast)',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
              round === option.value ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            <input
              type="radio"
              name="tripType"
              className="sr-only"
              checked={round === option.value}
              onChange={() => setTripType(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <div
        className={cn(
          'grid grid-cols-2 gap-3',
          compact
            ? 'md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]'
            : 'md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.1fr)_auto_minmax(0,1.1fr)_minmax(0,0.85fr)_minmax(0,0.85fr)]',
        )}
      >
        <div className="col-span-2 min-w-0 md:col-span-1">
          <AirportField
            label="From"
            icon={<PlaneTakeoff className="size-4" />}
            value={form.origin}
            onChange={(code, airport) => { rememberCity(airport); patch({ origin: code }); }}
          />
        </div>
        {/* Phones: the swap button sits on the right, between the two airports; md up: its own narrow column. */}
        <div className="pointer-events-none relative z-10 col-span-2 -my-4 flex justify-end pr-4 md:pointer-events-auto md:col-span-1 md:my-0 md:items-end md:justify-center md:pr-0">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Swap airports"
            className="group pointer-events-auto rounded-full shadow-sm"
            onClick={() => patch({ origin: form.destination, destination: form.origin })}
          >
            <ArrowLeftRight
              className="size-4 rotate-90 text-brand-700 transition-transform duration-(--duration-base) ease-out-soft group-hover:rotate-[270deg] md:rotate-0 md:group-hover:rotate-180"
              aria-hidden="true"
            />
          </Button>
        </div>
        <div className="col-span-2 min-w-0 md:col-span-1">
          <AirportField
            label="To"
            icon={<PlaneLanding className="size-4" />}
            value={form.destination}
            onChange={(code, airport) => { rememberCity(airport); patch({ destination: code }); }}
          />
        </div>
        <div className="min-w-0">
          <DateField label="Departure" months={2} min={todayIso()} value={form.departureDate}
            rangeEnd={round ? form.returnDate : undefined}
            onChange={(departureDate) => patch({ departureDate, returnDate: round && form.returnDate < departureDate ? departureDate : form.returnDate })} />
        </div>
        {/* md: the dates skip the narrow swap column; lg: one row. */}
        <div className="min-w-0 md:col-start-3 lg:col-start-auto">
          <DateField label="Return" months={2} min={form.departureDate || todayIso()} disabled={!round} value={form.returnDate}
            rangeStart={form.departureDate} placeholder={round ? undefined : 'One way'}
            onChange={(returnDate) => patch({ returnDate })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SelectField label="Adults (12+)" value={form.adults} onChange={(event) => setAdults(Number(event.target.value))}>
          {range(1, MAX_SEATS).map((n) => <option key={n} value={n}>{n}</option>)}
        </SelectField>
        <SelectField label="Children (2–11)" value={form.children} onChange={(event) => patch({ children: Number(event.target.value) })}>
          {range(0, MAX_SEATS - form.adults).map((n) => <option key={n} value={n}>{n}</option>)}
        </SelectField>
        <SelectField label="Infants (under 2)" value={form.infants} onChange={(event) => patch({ infants: Number(event.target.value) })}>
          {range(0, form.adults).map((n) => <option key={n} value={n}>{n}</option>)}
        </SelectField>
        <SelectField label="Travel class" value={form.cabin} onChange={(event) => patch({ cabin: event.target.value as Cabin })}>
          {(Object.keys(CABIN_LABELS) as Cabin[]).map((cabin) => <option key={cabin} value={cabin}>{CABIN_LABELS[cabin]}</option>)}
        </SelectField>
        <div className="col-span-2 flex items-end sm:col-span-1">
          <Button type="submit" size="lg" className="w-full">
            <Search className="size-4" aria-hidden="true" />
            Search flights
          </Button>
        </div>
      </div>
      {problem && <Alert tone="danger">{problem}</Alert>}
    </form>
  );
}
