import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ArrowRight, Plane } from 'lucide-react';

import { Skeleton } from '@/components/ui/Skeleton';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatMoney } from '@/lib/format';
import { flightApi } from './flightApi';
import { defaultFlightSearch, flightQueryOf } from './searchParams';
import type { PopularRoute } from './types';

/** The routes people fly most, as tiles that start a one-way search two weeks ahead. Nothing when there are none. */
export function PopularRoutes() {
  const navigate = useNavigate();
  const routes = useQuery({
    queryKey: queryKeys.flights.popular,
    queryFn: flightApi.popularRoutes,
    staleTime: 10 * 60_000,
  });
  if (routes.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 rounded-2xl" />)}
      </div>
    );
  }
  if (!routes.data || routes.data.length === 0) {
    return null;
  }
  const open = (route: PopularRoute) =>
    void navigate(`/flights/search?${flightQueryOf({ ...defaultFlightSearch(), origin: route.origin.iataCode, destination: route.destination.iataCode }).toString()}`);
  return (
    <section aria-labelledby="popular-routes-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="popular-routes-heading" className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">Popular routes</h2>
          <p className="mt-0.5 text-sm text-slate-600">Pick a route to see one-way fares two weeks from today.</p>
        </div>
      </div>
      <ul className="stagger mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {routes.data.map((route) => (
          <li key={`${route.origin.iataCode}-${route.destination.iataCode}`}>
            <button
              type="button"
              onClick={() => open(route)}
              className="group hover-lift relative flex h-full w-full flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 text-left shadow-card hover:border-brand-200"
            >
              <span aria-hidden="true" className="pointer-events-none absolute -bottom-10 -right-10 size-28 rounded-full bg-gradient-to-br from-brand-50 to-accent-50 transition-transform duration-(--duration-slow) ease-out-soft group-hover:scale-110" />
              <span aria-hidden="true" className="relative flex items-center gap-2 text-sm font-bold tracking-wide text-brand-700">
                {route.origin.iataCode}
                <span className="flex flex-1 items-center gap-1 text-brand-400">
                  <span className="h-px flex-1 border-t border-dashed border-brand-300" />
                  <Plane className="size-4 text-brand-600 transition-transform duration-(--duration-base) ease-out-soft group-hover:translate-x-1" />
                  <span className="h-px flex-1 border-t border-dashed border-brand-300" />
                </span>
                {route.destination.iataCode}
              </span>
              <span className="relative block font-semibold text-slate-900">{route.origin.city} to {route.destination.city}</span>
              <span className="relative mt-auto flex items-center justify-between gap-2">
                <span className="text-sm text-slate-600">from {formatMoney(route.fromPrice, route.currency)}</span>
                <ArrowRight className="size-4 text-brand-600 transition-transform duration-(--duration-base) group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
