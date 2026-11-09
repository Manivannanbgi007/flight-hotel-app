import { formatMoney } from '@/lib/format';
import { arrivalDayOffset, formatDuration, timeOf } from './flightFormat';
import type { FlightOption, FlightSort } from './types';

/**
 * Small facts about the flights on screen, so the customer sees the answer before choosing: the best value for each
 * sort order (shown on the sort tiles) and which flights are the cheapest or the fastest (the tags on the cards).
 * Everything comes from the options the API returned for the current filters.
 */

const smallest = <T>(items: T[], value: (item: T) => number | string): T =>
  items.reduce((best, item) => (value(item) < value(best) ? item : best));

/** The best value for each sort order ("₹18,482", "2h 9m", "10:10", "01:50 +1 day"), or null without flights. */
export function sortSummaries(options: FlightOption[]): Record<FlightSort, string> | null {
  if (options.length === 0) return null;
  const cheapest = smallest(options, (o) => o.totalPrice);
  const shortest = smallest(options, (o) => o.durationMinutes);
  // Local times as `YYYY-MM-DDTHH:mm` sort as text.
  const departsFirst = smallest(options, (o) => o.departureLocal);
  const arrivesFirst = smallest(options, (o) => o.arrivalLocal);
  const offset = arrivalDayOffset(arrivesFirst.departureLocal, arrivesFirst.arrivalLocal);
  return {
    PRICE_ASC: formatMoney(cheapest.totalPrice, cheapest.currency),
    DURATION_ASC: formatDuration(shortest.durationMinutes),
    DEPARTURE_ASC: timeOf(departsFirst.departureLocal),
    ARRIVAL_ASC: offset ? `${timeOf(arrivesFirst.arrivalLocal)} ${offset}` : timeOf(arrivesFirst.arrivalLocal),
  };
}

export interface FlightHighlights {
  cheapest: boolean;
  fastest: boolean;
}

/**
 * The "Cheapest" and "Fastest" tags. A tag goes to every flight with the best value (ties share it), and to none when
 * all flights have the same value: a tag on every card says nothing.
 */
export function highlightsOf(options: FlightOption[]): Map<string, FlightHighlights> {
  const best = (value: (o: FlightOption) => number) => {
    const values = options.map(value);
    const min = Math.min(...values);
    return values.every((v) => v === min) ? null : min;
  };
  const price = best((o) => o.totalPrice);
  const duration = best((o) => o.durationMinutes);
  return new Map(options.map((o) => [o.offerId, { cheapest: o.totalPrice === price, fastest: o.durationMinutes === duration }]));
}
