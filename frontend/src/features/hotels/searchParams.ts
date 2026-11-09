import { addDays, differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';

import { PROPERTY_TYPE_LABELS, SORT_LABELS, type PropertyType, type SearchSort, type Stay } from './types';

/**
 * The hotel search lives in the URL (/hotels/search?destination=Goa&checkIn=...), so results can be bookmarked,
 * shared and restored with the back button. This module is the only place that reads and writes those parameters.
 */
export interface HotelFilters {
  minPrice?: number;
  maxPrice?: number;
  stars: number[];
  minGuestRating?: number;
  amenities: string[];
  propertyTypes: PropertyType[];
  freeCancellation: boolean;
  breakfastIncluded: boolean;
  maxDistanceKm?: number;
  /** false = only hotels with a free room for the whole stay (the API's availableOnly). */
  showUnavailable: boolean;
  sort: SearchSort;
  page: number;
}

export interface HotelSearch {
  destination: string;
  stay: Stay;
  filters: HotelFilters;
}

export const EMPTY_FILTERS: HotelFilters = {
  stars: [],
  amenities: [],
  propertyTypes: [],
  freeCancellation: false,
  breakfastIncluded: false,
  showUnavailable: false,
  sort: 'RECOMMENDED',
  page: 0,
};

export const MAX_NIGHTS = 30;
export const MAX_ROOMS = 8;

const iso = (date: Date) => format(date, 'yyyy-MM-dd');

/** A sensible first stay: one week from today, two nights, one room, two adults. */
export function defaultStay(today: Date = new Date()): Stay {
  return { checkIn: iso(addDays(today, 7)), checkOut: iso(addDays(today, 9)), rooms: 1, adults: 2, children: 0, childAges: [] };
}

export function nightsOf(stay: Pick<Stay, 'checkIn' | 'checkOut'>): number {
  return differenceInCalendarDays(parseISO(stay.checkOut), parseISO(stay.checkIn));
}

function int(value: string | null, min: number, max: number): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

function num(value: string | null, min: number, max: number): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

function list(value: string | null): string[] {
  return value ? value.split(',').map((v) => v.trim()).filter(Boolean) : [];
}

function date(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return isValid(parseISO(value)) ? value : undefined;
}

/** Stay from the URL (missing or broken values fall back to the defaults). */
export function parseStay(params: URLSearchParams, today: Date = new Date()): Stay {
  const fallback = defaultStay(today);
  const checkIn = date(params.get('checkIn')) ?? fallback.checkIn;
  let checkOut = date(params.get('checkOut')) ?? fallback.checkOut;
  if (checkOut <= checkIn) {
    checkOut = iso(addDays(parseISO(checkIn), 1));
  }
  const rooms = int(params.get('rooms'), 1, MAX_ROOMS) ?? 1;
  const adults = Math.max(int(params.get('adults'), 1, 32) ?? 2, rooms);
  const children = int(params.get('children'), 0, 16) ?? 0;
  const ages = list(params.get('childAges')).map((a) => int(a, 0, 17)).filter((a): a is number => a !== undefined);
  return { checkIn, checkOut, rooms, adults, children, childAges: ages.slice(0, children) };
}

export function parseSearch(params: URLSearchParams, today: Date = new Date()): HotelSearch {
  const sort = params.get('sort');
  const minPrice = num(params.get('minPrice'), 0, 10_000_000);
  const maxPrice = num(params.get('maxPrice'), 0, 10_000_000);
  return {
    destination: (params.get('destination') ?? '').trim(),
    stay: parseStay(params, today),
    filters: {
      minPrice,
      maxPrice,
      stars: list(params.get('stars')).map((s) => int(s, 1, 5)).filter((s): s is number => s !== undefined),
      minGuestRating: num(params.get('minGuestRating'), 1, 5),
      amenities: list(params.get('amenities')).filter((code) => /^[A-Z0-9_]{2,40}$/.test(code)),
      propertyTypes: list(params.get('propertyTypes')).filter((t): t is PropertyType => t in PROPERTY_TYPE_LABELS),
      freeCancellation: params.get('freeCancellation') === 'true',
      breakfastIncluded: params.get('breakfastIncluded') === 'true',
      maxDistanceKm: num(params.get('maxDistanceKm'), 1, 100),
      showUnavailable: params.get('showUnavailable') === 'true',
      sort: sort && sort in SORT_LABELS ? (sort as SearchSort) : 'RECOMMENDED',
      page: int(params.get('page'), 0, 1000) ?? 0,
    },
  };
}

/** Stay parameters for links (search → hotel page → quote keep the same stay). */
export function stayParams(stay: Stay): URLSearchParams {
  const params = new URLSearchParams({
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    rooms: String(stay.rooms),
    adults: String(stay.adults),
  });
  if (stay.children > 0) {
    params.set('children', String(stay.children));
    params.set('childAges', stay.childAges.join(','));
  }
  return params;
}

/** The URL parameters of a search; defaults are left out so links stay short. */
export function searchParamsOf(search: HotelSearch): URLSearchParams {
  const params = new URLSearchParams({ destination: search.destination });
  stayParams(search.stay).forEach((value, key) => params.set(key, value));
  const f = search.filters;
  if (f.minPrice !== undefined) params.set('minPrice', String(f.minPrice));
  if (f.maxPrice !== undefined) params.set('maxPrice', String(f.maxPrice));
  if (f.stars.length) params.set('stars', [...f.stars].sort().join(','));
  if (f.minGuestRating !== undefined) params.set('minGuestRating', String(f.minGuestRating));
  if (f.amenities.length) params.set('amenities', [...f.amenities].sort().join(','));
  if (f.propertyTypes.length) params.set('propertyTypes', [...f.propertyTypes].sort().join(','));
  if (f.freeCancellation) params.set('freeCancellation', 'true');
  if (f.breakfastIncluded) params.set('breakfastIncluded', 'true');
  if (f.maxDistanceKm !== undefined) params.set('maxDistanceKm', String(f.maxDistanceKm));
  if (f.showUnavailable) params.set('showUnavailable', 'true');
  if (f.sort !== 'RECOMMENDED') params.set('sort', f.sort);
  if (f.page > 0) params.set('page', String(f.page));
  return params;
}

/** The query string for GET /api/hotels/search (the API wants availableOnly instead of showUnavailable). */
export function apiQueryOf(search: HotelSearch, size = 20): URLSearchParams {
  const params = searchParamsOf(search);
  params.delete('showUnavailable');
  params.set('availableOnly', String(!search.filters.showUnavailable));
  params.set('page', String(search.filters.page));
  params.set('size', String(size));
  return params;
}

/** Changing a filter starts again on the first page. */
export function withFilters(search: HotelSearch, patch: Partial<HotelFilters>): HotelSearch {
  return { ...search, filters: { ...search.filters, page: 0, ...patch } };
}

/** "2 adults, 1 child · 1 room". */
export function describeGuests(stay: Pick<Stay, 'rooms' | 'adults' | 'children'>): string {
  const people = [`${stay.adults} adult${stay.adults === 1 ? '' : 's'}`];
  if (stay.children > 0) people.push(`${stay.children} child${stay.children === 1 ? '' : 'ren'}`);
  return `${people.join(', ')} · ${stay.rooms} room${stay.rooms === 1 ? '' : 's'}`;
}
