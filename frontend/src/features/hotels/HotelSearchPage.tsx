import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowUpDown, CalendarDays, SlidersHorizontal, Users } from 'lucide-react';

import { HotelIllustration } from '@/components/illustrations';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { selectClass } from '@/components/ui/fieldStyles';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { formatShortDate } from '@/lib/format';
import { hotelApi } from './hotelApi';
import { HotelFilters } from './HotelFilters';
import { HotelResultCard, HotelResultCardSkeleton } from './HotelResultCard';
import { HotelSearchForm } from './HotelSearchForm';
import { describeGuests, EMPTY_FILTERS, parseSearch, searchParamsOf, withFilters, type HotelFilters as Filters } from './searchParams';
import { SORT_LABELS, type SearchSort, type Stay } from './types';

const PAGE_SIZE = 10;

/** /hotels/search?destination=…: results with filters, sorting and paging; everything is kept in the URL. */
export function HotelSearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const search = useMemo(() => parseSearch(params), [params]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const results = useQuery({
    queryKey: queryKeys.hotels.search(searchParamsOf(search).toString()),
    queryFn: () => hotelApi.search(search, PAGE_SIZE),
    enabled: search.destination.length >= 2,
    placeholderData: keepPreviousData,
  });
  const amenities = useQuery({ queryKey: queryKeys.hotels.amenities, queryFn: hotelApi.amenities, staleTime: Infinity });
  const amenityNames = useMemo(() => new Map((amenities.data ?? []).map((a) => [a.code, a.name])), [amenities.data]);

  // flushSync: the URL (and with it every controlled filter input) updates in the same frame as the click;
  // as a transition the checkbox would briefly flip back to its old state.
  const go = (next: typeof search) => void navigate(`/hotels/search?${searchParamsOf(next).toString()}`, { flushSync: true });
  const changeFilters = (patch: Partial<Filters>) => go(withFilters(search, patch));
  const newSearch = (destination: string, stay: Stay) => go({ ...withFilters(search, {}), destination, stay });

  const data = results.data;
  const error = results.error ? ApiError.from(results.error) : null;
  const searching = search.destination.length >= 2;

  return (
    <PageContainer>
      <Card variant="elevated" className="p-4 sm:p-5">
        <HotelSearchForm key={params.toString()} destination={search.destination} stay={search.stay} onSearch={newSearch} compact />
      </Card>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 animate-fade-up">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">Hotels</p>
          <h1 id="results-heading" className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {data ? `${data.totalElements} hotel${data.totalElements === 1 ? '' : 's'} in ${search.destination}` : `Hotels in ${search.destination}`}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4 text-brand-600" aria-hidden="true" />
              {formatShortDate(search.stay.checkIn)} – {formatShortDate(search.stay.checkOut)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4 text-brand-600" aria-hidden="true" />
              {describeGuests(search.stay)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="lg:hidden" aria-expanded={filtersOpen} aria-controls="hotel-filters"
            onClick={() => setFiltersOpen((open) => !open)}>
            <SlidersHorizontal className="size-4" aria-hidden="true" /> Filters
          </Button>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ArrowUpDown className="size-4 text-slate-500" aria-hidden="true" />
            Sort by
            <select value={search.filters.sort} onChange={(e) => changeFilters({ sort: e.target.value as SearchSort })}
              className={cn(selectClass(false, { inline: true, size: 'sm' }), 'min-w-44 font-medium')}>
              {(Object.keys(SORT_LABELS) as SearchSort[]).map((sort) => (
                <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[17.5rem_minmax(0,1fr)]">
        <aside id="hotel-filters" aria-label="Filters" className={filtersOpen ? 'block animate-slide-down lg:animate-none' : 'hidden lg:block'}>
          <Card className="p-4 sm:p-5 lg:sticky lg:top-24">
            <HotelFilters
              filters={search.filters}
              facets={data?.facets}
              amenities={amenities.data ?? []}
              destinationCity={data?.destination.city ?? null}
              onChange={changeFilters}
            />
          </Card>
        </aside>

        <section aria-labelledby="results-heading" aria-busy={results.isFetching} className="min-w-0">
          {!searching && (
            <EmptyState
              illustration={<div className="w-40 sm:w-44"><HotelIllustration /></div>}
              title="Where are you going?"
              description="Enter a city or hotel name above to see available hotels."
            />
          )}
          {results.isPending && searching && (
            <div className="flex flex-col gap-4">
              <span role="status" className="sr-only">Loading hotels…</span>
              {[0, 1, 2].map((i) => <HotelResultCardSkeleton key={i} />)}
            </div>
          )}
          {error && (
            <ErrorState
              title="The search did not work"
              description={error.message}
              correlationId={error.status >= 500 ? error.correlationId : null}
              onRetry={() => void results.refetch()}
            />
          )}
          {data && data.content.length === 0 && (
            <EmptyState
              illustration="search"
              title="No hotels match"
              description="Try other dates, fewer filters or a nearby city."
              action={
                <Button variant="secondary" onClick={() => changeFilters({ ...EMPTY_FILTERS, sort: search.filters.sort })}>
                  Clear filters
                </Button>
              }
            />
          )}
          {data && data.content.length > 0 && (
            <>
              <ol className={cn('flex flex-col gap-4 stagger transition-opacity duration-(--duration-base)', results.isFetching && 'opacity-60')}>
                {data.content.map((hotel) => (
                  <li key={hotel.id}>
                    <HotelResultCard hotel={hotel} stay={search.stay} nights={data.nights}
                      distanceFrom={data.destination.distanceFrom} amenityNames={amenityNames} />
                  </li>
                ))}
              </ol>
              <Pagination
                data={data}
                onPageChange={(page) => go({ ...search, filters: { ...search.filters, page } })}
                noun={['hotel', 'hotels']}
                className="mt-8"
              />
            </>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
