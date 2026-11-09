import { addDays, format, isValid, parseISO } from 'date-fns';

import { SORT_LABELS, type Cabin, type FlightSort } from './types';

/**
 * The flight search lives in the URL (/flights/search?origin=DEL&destination=BOM&departureDate=...), so results can be
 * bookmarked and restored with the back button. The parameter names are the API's own, so the same query string goes
 * to `GET /api/flights/search`. This module is the only place that reads and writes them.
 */
export interface FlightSearch {
  origin: string;
  destination: string;
  departureDate: string;
  /** '' = one way. */
  returnDate: string;
  adults: number;
  children: number;
  infants: number;
  cabin: Cabin;
}

export interface FlightFilters {
  airlines: string[];
  maxStops?: number;
  maxPrice?: number;
  refundable?: boolean;
  departAfter: string;
  departBefore: string;
  arriveAfter: string;
  arriveBefore: string;
  maxDurationMinutes?: number;
  sort: FlightSort;
}

export const EMPTY_FLIGHT_FILTERS: FlightFilters = {
  airlines: [],
  departAfter: '',
  departBefore: '',
  arriveAfter: '',
  arriveBefore: '',
  sort: 'PRICE_ASC',
};

export const MAX_SEATS = 9;
export const MAX_DAYS_AHEAD = 330;
const CABINS: Cabin[] = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];

const iso = (date: Date) => format(date, 'yyyy-MM-dd');

/** First search: one-way, two weeks from today, one adult, economy. Origin and destination stay empty. */
export function defaultFlightSearch(today: Date = new Date()): FlightSearch {
  return {
    origin: '', destination: '', departureDate: iso(addDays(today, 14)), returnDate: '',
    adults: 1, children: 0, infants: 0, cabin: 'ECONOMY',
  };
}

function int(value: string | null, min: number, max: number): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

function date(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  return isValid(parseISO(value)) ? value : '';
}

const code = (value: string | null, length: number): string => {
  const upper = (value ?? '').trim().toUpperCase();
  return new RegExp(`^[A-Z0-9]{${length}}$`).test(upper) ? upper : '';
};

const time = (value: string | null): string => (value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '');

export function parseFlightSearch(params: URLSearchParams, today: Date = new Date()): { search: FlightSearch; filters: FlightFilters } {
  const fallback = defaultFlightSearch(today);
  const adults = int(params.get('adults'), 1, MAX_SEATS) ?? 1;
  const children = Math.min(int(params.get('children'), 0, 8) ?? 0, MAX_SEATS - adults);
  const infants = Math.min(int(params.get('infants'), 0, 9) ?? 0, adults);
  const cabin = params.get('cabin');
  const sort = params.get('sort');
  const refundable = params.get('refundable');
  return {
    search: {
      origin: code(params.get('origin'), 3),
      destination: code(params.get('destination'), 3),
      departureDate: date(params.get('departureDate')) || fallback.departureDate,
      returnDate: date(params.get('returnDate')),
      adults, children, infants,
      cabin: CABINS.includes(cabin as Cabin) ? (cabin as Cabin) : 'ECONOMY',
    },
    filters: {
      airlines: (params.get('airlines') ?? '').split(',').map((a) => a.trim().toUpperCase()).filter((a) => /^[A-Z0-9]{2}$/.test(a)),
      maxStops: int(params.get('maxStops'), 0, 2),
      maxPrice: int(params.get('maxPrice'), 0, 100_000_000),
      refundable: refundable === 'true' ? true : refundable === 'false' ? false : undefined,
      departAfter: time(params.get('departAfter')),
      departBefore: time(params.get('departBefore')),
      arriveAfter: time(params.get('arriveAfter')),
      arriveBefore: time(params.get('arriveBefore')),
      maxDurationMinutes: int(params.get('maxDurationMinutes'), 30, 3000),
      sort: sort && sort in SORT_LABELS ? (sort as FlightSort) : 'PRICE_ASC',
    },
  };
}

/** The query string for the URL and for the API (empty and default values are left out). */
export function flightQueryOf(search: FlightSearch, filters: FlightFilters = EMPTY_FLIGHT_FILTERS): URLSearchParams {
  const params = new URLSearchParams({ origin: search.origin, destination: search.destination, departureDate: search.departureDate });
  if (search.returnDate) params.set('returnDate', search.returnDate);
  params.set('adults', String(search.adults));
  if (search.children > 0) params.set('children', String(search.children));
  if (search.infants > 0) params.set('infants', String(search.infants));
  if (search.cabin !== 'ECONOMY') params.set('cabin', search.cabin);
  if (filters.airlines.length > 0) params.set('airlines', filters.airlines.join(','));
  if (filters.maxStops !== undefined) params.set('maxStops', String(filters.maxStops));
  if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
  if (filters.refundable !== undefined) params.set('refundable', String(filters.refundable));
  if (filters.departAfter) params.set('departAfter', filters.departAfter);
  if (filters.departBefore) params.set('departBefore', filters.departBefore);
  if (filters.arriveAfter) params.set('arriveAfter', filters.arriveAfter);
  if (filters.arriveBefore) params.set('arriveBefore', filters.arriveBefore);
  if (filters.maxDurationMinutes !== undefined) params.set('maxDurationMinutes', String(filters.maxDurationMinutes));
  if (filters.sort !== 'PRICE_ASC') params.set('sort', filters.sort);
  return params;
}

/** Why a search cannot be sent yet, or null when it can (same rules as the API). */
export function searchProblem(search: FlightSearch, today: Date = new Date()): string | null {
  if (!search.origin) return 'Choose where you fly from';
  if (!search.destination) return 'Choose where you fly to';
  if (search.origin === search.destination) return 'The two airports must be different';
  const todayText = iso(today);
  if (!search.departureDate || search.departureDate < todayText) return 'The departure date cannot be in the past';
  const last = iso(addDays(today, MAX_DAYS_AHEAD));
  if (search.departureDate > last) return 'Flights can be booked up to 330 days ahead';
  if (search.returnDate) {
    if (search.returnDate < search.departureDate) return 'The return date cannot be before the departure date';
    if (search.returnDate > last) return 'Flights can be booked up to 330 days ahead';
  }
  if (search.adults < 1) return 'At least one adult must travel';
  if (search.infants > search.adults) return 'Each infant needs an adult (at most one infant per adult)';
  if (search.adults + search.children > MAX_SEATS) return `At most ${MAX_SEATS} travellers with a seat`;
  return null;
}

export function describeTravellers(search: Pick<FlightSearch, 'adults' | 'children' | 'infants'>): string {
  const parts = [`${search.adults} adult${search.adults === 1 ? '' : 's'}`];
  if (search.children > 0) parts.push(`${search.children} child${search.children === 1 ? '' : 'ren'}`);
  if (search.infants > 0) parts.push(`${search.infants} infant${search.infants === 1 ? '' : 's'}`);
  return parts.join(', ');
}

export const hasActiveFilters = (filters: FlightFilters): boolean =>
  JSON.stringify({ ...filters, sort: 'PRICE_ASC' }) !== JSON.stringify(EMPTY_FLIGHT_FILTERS);

/** How many filter groups narrow the list (the airlines count once; the sorting is not a filter). */
export function activeFilterCount(filters: FlightFilters): number {
  return [
    filters.airlines.length > 0,
    filters.maxStops !== undefined,
    filters.maxPrice !== undefined,
    filters.refundable !== undefined,
    filters.departAfter !== '' || filters.departBefore !== '',
    filters.arriveAfter !== '' || filters.arriveBefore !== '',
    filters.maxDurationMinutes !== undefined,
  ].filter(Boolean).length;
}

/**
 * The patch that sets every filter back to "any" and keeps the sorting. Optional filters are set to an explicit
 * undefined, because the patch is merged into the current filters.
 */
export function clearedFlightFilters(sort: FlightSort): Partial<FlightFilters> {
  return { ...EMPTY_FLIGHT_FILTERS, maxStops: undefined, maxPrice: undefined, refundable: undefined, maxDurationMinutes: undefined, sort };
}

/** Part-of-day choices for the departure and arrival filters (`name` and `hours` are the two lines of a tile). */
export const DAY_PARTS: { label: string; name: string; hours: string; after: string; before: string }[] = [
  { label: 'Night (00:00–06:00)', name: 'Night', hours: '00:00–06:00', after: '00:00', before: '06:00' },
  { label: 'Morning (06:00–12:00)', name: 'Morning', hours: '06:00–12:00', after: '06:00', before: '12:00' },
  { label: 'Afternoon (12:00–18:00)', name: 'Afternoon', hours: '12:00–18:00', after: '12:00', before: '18:00' },
  { label: 'Evening (18:00–24:00)', name: 'Evening', hours: '18:00–24:00', after: '18:00', before: '23:59' },
];
