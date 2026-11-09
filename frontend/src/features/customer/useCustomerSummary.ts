import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/queryKeys';
import { summaryApi, summaryQuery, type CustomerSummary, type SummaryParams } from './summaryApi';
import { compareFigure, previousPeriod, type Comparison } from './summaryRange';

export interface SummaryComparisons {
  bookings: Comparison;
  hotel: Comparison;
  flight: Comparison;
  paid: Comparison;
  refunded: Comparison;
  net: Comparison;
}

/**
 * A customer who has never had a trip (none upcoming, completed, cancelled or waiting for payment): the dashboard
 * invites them to book instead of showing a wall of zeros. `trips` does not depend on the period.
 */
export function isFirstTimeCustomer(summary: CustomerSummary): boolean {
  const { trips } = summary;
  return trips.upcoming + trips.completed + trips.cancelled + trips.pending === 0 && summary.bookings.total === 0 && !summary.nextTrip;
}

/** The figures the KPI cards compare with the period before. */
export function compareSummaries(current: CustomerSummary, previous: CustomerSummary): SummaryComparisons {
  return {
    bookings: compareFigure(current.bookings.total, previous.bookings.total),
    hotel: compareFigure(current.bookings.hotel, previous.bookings.hotel),
    flight: compareFigure(current.bookings.flight, previous.bookings.flight),
    paid: compareFigure(current.spending.paid, previous.spending.paid),
    refunded: compareFigure(current.spending.refunded, previous.spending.refunded),
    net: compareFigure(current.spending.net, previous.spending.net),
  };
}

/**
 * The summary for the chosen period and, because the endpoint has no comparison block, a second call for the period
 * of the same length right before it (`range=CUSTOM`, the days before `range.from` as the server resolved it). "All
 * time" has nothing before it, so it is not compared.
 */
export function useCustomerSummary(params: SummaryParams) {
  const query = summaryQuery(params);
  const current = useQuery({
    queryKey: queryKeys.bookings.summary(query),
    queryFn: () => summaryApi.summary(params),
    placeholderData: keepPreviousData,
  });

  const resolved = current.data?.range;
  const previousRange = resolved && resolved.preset !== 'ALL_TIME' ? previousPeriod(resolved) : null;
  const previousParams: SummaryParams | null = previousRange ? { range: 'CUSTOM', ...previousRange } : null;
  const previous = useQuery({
    queryKey: queryKeys.bookings.summary(previousParams ? summaryQuery(previousParams) : { range: 'NONE' }),
    queryFn: () => summaryApi.summary(previousParams!),
    enabled: previousParams !== null,
  });

  const comparisons = current.data && previous.data && previousParams
    ? compareSummaries(current.data, previous.data)
    : null;

  return { current, previous, previousRange, comparisons };
}
