import { useId, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { Check, Plane, SlidersHorizontal } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { formatMoney, formatShortDate } from '@/lib/format';
import { CompareFlights, MAX_COMPARED } from './CompareFlights';
import { AirlineMark } from './FlightBadges';
import { FlightFilters } from './FlightFilters';
import { flightApi } from './flightApi';
import { dateOf, formatDuration, timeOf } from './flightFormat';
import { FlightOptionCard } from './FlightOptionCard';
import { FlightResultsHero } from './FlightResultsHero';
import { FlightSearchForm } from './FlightSearchForm';
import { FlightSortBar } from './FlightSortBar';
import { highlightsOf, sortSummaries } from './resultInsights';
import {
  activeFilterCount,
  clearedFlightFilters,
  flightQueryOf,
  hasActiveFilters,
  parseFlightSearch,
  searchProblem,
  type FlightFilters as Filters,
  type FlightSearch,
} from './searchParams';
import type { FlightOption, FlightSort } from './types';

/** How the list is ordered, after the count ("4 flights · cheapest first"). */
const ORDER_HINTS: Record<FlightSort, string> = {
  PRICE_ASC: 'cheapest first',
  DURATION_ASC: 'shortest first',
  DEPARTURE_ASC: 'earliest departure first',
  ARRIVAL_ASC: 'earliest arrival first',
};

/**
 * /flights/search — results for one direction at a time. A round trip first asks for the outbound flight, then for
 * the return flight; the chosen flights are re-priced (revalidate) before the details page opens.
 *
 * Layout: the route band (title, the search as chips, "Modify search" opens the form), then the filters beside the
 * results: sort tiles that show the best value of each order, and the flight cards.
 */
export function FlightSearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { search, filters } = useMemo(() => parseFlightSearch(params), [params]);
  const problem = searchProblem(search);
  const query = flightQueryOf(search, filters).toString();
  const roundTrip = search.returnDate !== '';
  const formId = useId();
  const filtersId = useId();

  const results = useQuery({
    queryKey: queryKeys.flights.search(query),
    queryFn: () => flightApi.search(query),
    enabled: problem === null,
    retry: false,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const [outbound, setOutbound] = useState<FlightOption | null>(null);
  const [compared, setCompared] = useState<FlightOption[]>([]);
  const [comparing, setComparing] = useState(false);
  // The search form folds away behind "Modify search" (the band above says what was searched); on phones the
  // filters fold away too, so the results come first.
  const [editing, setEditing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const step: 'outbound' | 'inbound' = roundTrip && outbound ? 'inbound' : 'outbound';
  const direction = step === 'inbound' ? results.data?.inbound : results.data?.outbound;
  // The filter choices (airlines, prices, stops) always describe the direction being shown.
  const facets = step === 'inbound' ? (results.data?.inboundFacets ?? results.data?.facets) : results.data?.facets;
  const selectLabel = !roundTrip ? 'Select' : step === 'outbound' ? 'Select outbound' : 'Select return';
  const updating = results.isFetching && results.isPlaceholderData;
  const options = useMemo(() => direction?.options ?? [], [direction]);
  const summaries = useMemo(() => sortSummaries(options), [options]);
  const highlights = useMemo(() => highlightsOf(options), [options]);
  const activeFilters = activeFilterCount(filters);

  // flushSync: the URL (and with it every controlled filter input) updates in the same frame as the click;
  // as a transition the radio button or checkbox would briefly flip back to its old state.
  const setFilters = (patch: Partial<Filters>) => {
    setParams(flightQueryOf(search, { ...filters, ...patch }), { replace: true, flushSync: true });
    setCompared([]);
  };
  const newSearch = (next: FlightSearch) => {
    setOutbound(null);
    setCompared([]);
    setEditing(false);
    setParams(flightQueryOf(next, filters));
  };

  const revalidate = useMutation({
    mutationFn: (offerIds: string[]) => flightApi.revalidate(offerIds),
    onSuccess: (trip) => {
      queryClient.setQueryData(queryKeys.flights.trip(trip.tripOfferId), trip);
      void navigate(`/flights/trip/${trip.tripOfferId}`);
    },
    onError: () => void results.refetch(),
  });

  const select = (option: FlightOption) => {
    setComparing(false);
    setCompared([]);
    if (roundTrip && step === 'outbound') {
      setOutbound(option);
      window.scrollTo?.({ top: 0 });
      return;
    }
    revalidate.mutate(outbound ? [outbound.offerId, option.offerId] : [option.offerId]);
  };

  const toggleCompare = (option: FlightOption) =>
    setCompared((list) => (list.some((o) => o.offerId === option.offerId) ? list.filter((o) => o.offerId !== option.offerId) : [...list, option].slice(0, MAX_COMPARED)));

  const error = revalidate.error ? ApiError.from(revalidate.error) : null;
  const showForm = editing || problem !== null;
  // The band shows the direction being chosen; city names arrive with the results.
  const from = step === 'inbound' ? search.destination : search.origin;
  const to = step === 'inbound' ? search.origin : search.destination;

  return (
    <PageContainer width="xl" className={cn('pt-4 sm:pt-6', compared.length >= 2 && 'pb-32')}>
      {!problem && (
        <FlightResultsHero
          search={search}
          from={{ code: from, city: direction?.origin.city }}
          to={{ code: to, city: direction?.destination.city }}
          step={roundTrip ? step : null}
          demo={results.data?.demo ?? false}
          formId={formId}
          editing={showForm}
          onModify={() => setEditing((open) => !open)}
        />
      )}
      <Card id={formId} variant="elevated" className={cn('p-4 sm:p-5', showForm ? 'block' : 'hidden', !problem && 'mt-4 animate-slide-down')}>
        <FlightSearchForm key={JSON.stringify(search)} search={search} onSearch={newSearch} compact />
      </Card>

      {problem && (
        <div className="mt-6"><Alert tone="warning" title="Complete your search">{problem}</Alert></div>
      )}

      {!problem && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[17.5rem_minmax(0,1fr)]">
          <aside
            id={filtersId}
            aria-label="Filters"
            className={cn('lg:sticky lg:top-20 lg:self-start', filtersOpen ? 'block animate-slide-down lg:animate-none' : 'hidden lg:block')}
          >
            <Card className="p-5">
              <FlightFilters filters={filters} facets={facets} onChange={setFilters} />
              <Button className="mt-5 w-full lg:hidden" aria-controls={filtersId} onClick={() => { setFiltersOpen(false); filtersButton.current?.focus(); }}>
                Show flights
              </Button>
            </Card>
          </aside>

          <section aria-label="Results" aria-busy={results.isFetching} className="min-w-0">
            {results.isPending && <ResultsLoading from={from} to={to} />}
            {results.isError && <SearchError error={ApiError.from(results.error)} onRetry={() => void results.refetch()} />}

            {results.data && direction && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p role="status" className="text-sm text-slate-600">
                    <strong className="text-base font-bold text-slate-900">
                      {direction.options.length === direction.totalOptions
                        ? `${direction.options.length} flight${direction.options.length === 1 ? '' : 's'}`
                        : `${direction.options.length} of ${direction.totalOptions} flights`}
                    </strong>
                    {direction.options.length > 1 && <> · {ORDER_HINTS[filters.sort]}</>}
                  </p>
                  <Button ref={filtersButton} variant="secondary" className="lg:hidden" aria-expanded={filtersOpen} aria-controls={filtersId}
                    onClick={() => setFiltersOpen((open) => !open)}>
                    <SlidersHorizontal className="size-4" aria-hidden="true" /> Filters
                    {activeFilters > 0 && (
                      <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{activeFilters}</span>
                    )}
                  </Button>
                </div>

                <FlightSortBar className="mt-3" value={filters.sort} summaries={summaries} onChange={(sort) => setFilters({ sort })} />

                {outbound && step === 'inbound' && <ChosenOutbound outbound={outbound} onChange={() => { setOutbound(null); setCompared([]); }} />}

                {error && (
                  <div className="mt-4">
                    <Alert tone="danger" title={error.code === 'OFFER_EXPIRED' ? 'This fare is no longer available' : 'We could not check this flight'}>
                      {error.code === 'OFFER_EXPIRED' ? 'Fares are kept for 20 minutes. The list was refreshed, please choose again.' : error.message}
                    </Alert>
                  </div>
                )}

                {updating && (
                  <p className="mt-4 flex items-center gap-3 text-sm font-medium text-slate-600">
                    <span aria-hidden="true" className="relative h-1.5 w-24 overflow-hidden rounded-full bg-brand-100">
                      <span className="block h-full w-2/5 rounded-full bg-gradient-to-r from-brand-400 to-brand-600 animate-indeterminate" />
                    </span>
                    Updating the results…
                  </p>
                )}

                {direction.options.length === 0 ? (
                  <div className="mt-4">
                    <EmptyState
                      illustration="search"
                      title="No flights match"
                      description="Try removing a filter, another date or another cabin."
                      action={hasActiveFilters(filters)
                        ? <Button variant="secondary" onClick={() => setFilters(clearedFlightFilters(filters.sort))}>Clear filters</Button>
                        : undefined}
                    />
                  </div>
                ) : (
                  <ul className={cn('stagger mt-4 flex flex-col gap-4 transition-opacity duration-(--duration-base)', updating && 'opacity-60')} aria-label="Flights">
                    {direction.options.map((option) => (
                      <FlightOptionCard
                        key={option.offerId}
                        option={option}
                        highlights={highlights.get(option.offerId)}
                        selectLabel={selectLabel}
                        onSelect={() => select(option)}
                        busy={revalidate.isPending && revalidate.variables?.includes(option.offerId)}
                        compared={compared.some((o) => o.offerId === option.offerId)}
                        compareDisabled={compared.length >= MAX_COMPARED}
                        onToggleCompare={() => toggleCompare(option)}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {/* The compare tray floats bottom-left (centred from sm up): the bottom-right corner stays free. */}
      {compared.length >= 2 && (
        <div className="glass fixed bottom-4 left-4 right-20 z-40 rounded-2xl border border-slate-200/80 p-3 shadow-xl animate-fade-up sm:left-1/2 sm:right-auto sm:w-[30rem] sm:-translate-x-1/2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2.5 pl-1">
              <span aria-hidden="true" className="hidden -space-x-2 sm:flex">
                {compared.map((option) => (
                  <span key={option.offerId} className="rounded-xl ring-2 ring-white animate-pop">
                    <AirlineMark code={option.airline.code} name={option.airline.name} size="sm" />
                  </span>
                ))}
              </span>
              <span className="whitespace-nowrap text-xs font-semibold text-slate-800 sm:text-sm">
                {compared.length}<span className="hidden sm:inline"> flights selected</span><span className="sm:hidden"> selected</span>
                <span className="sr-only"> to compare</span>
              </span>
            </span>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="sm" className="px-2.5" onClick={() => setCompared([])}>Clear</Button>
              <Button size="sm" onClick={() => setComparing(true)}>Compare flights</Button>
            </div>
          </div>
        </div>
      )}
      {comparing && compared.length >= 2 && (
        <CompareFlights
          options={compared}
          selectLabel={selectLabel}
          onSelect={select}
          onRemove={(id) => setCompared((list) => list.filter((o) => o.offerId !== id))}
          onClose={() => setComparing(false)}
        />
      )}
    </PageContainer>
  );
}

/** Round trip, step 2: the outbound flight already chosen, with a way back to step 1. */
function ChosenOutbound({ outbound, onChange }: { outbound: FlightOption; onChange: () => void }) {
  return (
    <Card variant="tinted" className="mt-4 flex flex-wrap items-center gap-3 p-4 text-sm text-slate-800 animate-fade-in">
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-600 text-white shadow-sm animate-pop">
        <Check className="size-4" strokeWidth={3} />
      </span>
      <AirlineMark code={outbound.airline.code} name={outbound.airline.name} size="sm" />
      <span className="min-w-0 flex-1">
        <strong>Outbound:</strong> {outbound.airline.name} {outbound.flightNumber} · {formatShortDate(dateOf(outbound.departureLocal))} {timeOf(outbound.departureLocal)}
        {' → '}{timeOf(outbound.arrivalLocal)} · {formatDuration(outbound.durationMinutes)} · {formatMoney(outbound.totalPrice, outbound.currency)}
      </span>
      <Button variant="secondary" size="sm" onClick={onChange}>Change outbound</Button>
    </Card>
  );
}

/**
 * While the first answer loads: a plane crossing a dashed line between the two airports, then placeholders in the
 * shape of the result cards.
 */
function ResultsLoading({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="px-5 py-6 sm:px-8">
        <div aria-hidden="true" className="flex items-center gap-4">
          <span className="text-xl font-extrabold tracking-tight text-slate-900">{from}</span>
          <span className="relative h-7 flex-1 overflow-hidden">
            <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-[repeating-linear-gradient(90deg,var(--color-slate-300)_0_6px,transparent_6px_11px)]" />
            <span className="absolute inset-y-0 left-0 flex w-2/5 items-center justify-end animate-indeterminate">
              <span className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-white shadow-glow">
                <Plane className="size-4 rotate-45 text-white" />
              </span>
            </span>
          </span>
          <span className="text-xl font-extrabold tracking-tight text-slate-900">{to}</span>
        </div>
        <p role="status" className="mt-4 text-center text-sm font-medium text-slate-600">Searching for flights…</p>
      </Card>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
          <div className="grid md:grid-cols-[minmax(0,1fr)_13.5rem]">
            <div className="p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-11 rounded-xl" />
                <div className="flex flex-col gap-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-14" /></div>
              </div>
              <div className="mt-5 flex items-center gap-4">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-1 flex-1" />
                <Skeleton className="h-8 w-16" />
              </div>
              <div className="mt-5 flex gap-2"><Skeleton className="h-5 w-32 rounded-full" /><Skeleton className="h-5 w-40 rounded-full" /></div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 p-5 md:flex-col md:items-stretch md:justify-center md:border-l md:border-t-0">
              <Skeleton className="h-8 w-28 md:self-end" />
              <Skeleton className="h-10 w-32 md:w-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SearchError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  if (error.code === 'FLIGHT_SEARCH_UNAVAILABLE') {
    return <ErrorState title="Flight search is temporarily unavailable" description="Please try again in a few minutes." onRetry={onRetry} />;
  }
  return <ErrorState description={error.message} correlationId={error.correlationId} onRetry={onRetry} />;
}
