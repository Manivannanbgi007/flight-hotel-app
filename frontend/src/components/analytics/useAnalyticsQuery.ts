import { useSearchParams } from 'react-router';

import { readAnalyticsQuery, writeAnalyticsQuery, type AnalyticsQuery } from './range';

/** The analytics range and interval kept in the URL (`?range=&from=&to=&interval=`); other parameters stay. */
export function useAnalyticsQuery(): [AnalyticsQuery, (next: AnalyticsQuery) => void] {
  const [params, setParams] = useSearchParams();
  return [readAnalyticsQuery(params), (next) => setParams(writeAnalyticsQuery(params, next))];
}
