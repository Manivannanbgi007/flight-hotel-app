import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { analyticsApiParams, DEFAULT_ANALYTICS_QUERY, type AnalyticsQuery } from '@/components/analytics/range';
import { queryKeys } from '@/lib/api/queryKeys';
import { operationsApi } from './operationsApi';

/** The dashboard of one hotel for a range (the cache is shared with the portfolio cards for the default range). */
export function useHotelDashboard(hotelId: string, query: AnalyticsQuery) {
  return useQuery({
    queryKey: queryKeys.hotelManager.dashboardRange(hotelId, analyticsApiParams(query)),
    queryFn: () => operationsApi.dashboard(hotelId, query),
    placeholderData: keepPreviousData,
    enabled: hotelId !== '',
  });
}

/** At most this many hotel dashboards load at the same time on the portfolio page. */
export const PORTFOLIO_PARALLEL = 2;

let running = 0;
const waiting: (() => void)[] = [];

/** Runs `task` when fewer than PORTFOLIO_PARALLEL tasks are running (first come, first served). */
export async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= PORTFOLIO_PARALLEL) {
    // A finishing task hands its slot over (`running` already counts this one).
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

/**
 * The default-range dashboard of a hotel for its portfolio card, through the limiter (a manager with many hotels
 * does not fire every request at once). Same cache entry as the hotel's own dashboard page.
 */
export function usePortfolioDashboard(hotelId: string) {
  return useQuery({
    queryKey: queryKeys.hotelManager.dashboardRange(hotelId, analyticsApiParams(DEFAULT_ANALYTICS_QUERY)),
    queryFn: () => limited(() => operationsApi.dashboard(hotelId, DEFAULT_ANALYTICS_QUERY)),
    staleTime: 60_000,
  });
}
