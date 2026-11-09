import { useMemo, useSyncExternalStore } from 'react';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { z } from 'zod';

import { todayIso } from '@/features/account/schemas';
import { flightQueryOf, type FlightSearch } from '@/features/flights/searchParams';
import { CABIN_LABELS, type Cabin } from '@/features/flights/types';
import { describeGuests, EMPTY_FILTERS, searchParamsOf } from '@/features/hotels/searchParams';
import type { Stay } from '@/features/hotels/types';
import { formatShortDate } from '@/lib/format';

/**
 * "Recently viewed searches": the last 5 hotel and flight searches, kept in this browser only (localStorage, per
 * device; nothing goes to the server). Storage can be missing, full or blocked (private mode, disabled cookies), and
 * its content can be anything: every access is guarded and every entry is validated, so the worst case is an empty
 * list.
 */
export const RECENT_SEARCHES_KEY = 'fh.recent-searches.v1';
export const MAX_RECENT_SEARCHES = 5;
const CHANGE_EVENT = 'fh:recent-searches';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const airportCode = z.string().regex(/^[A-Z0-9]{3}$/);

const hotelEntry = z.object({
  kind: z.literal('HOTEL'),
  destination: z.string().trim().min(1).max(100),
  stay: z.object({
    checkIn: isoDate,
    checkOut: isoDate,
    rooms: z.number().int().min(1).max(8),
    adults: z.number().int().min(1).max(32),
    children: z.number().int().min(0).max(16),
    childAges: z.array(z.number().int().min(0).max(17)).max(16),
  }),
  savedAt: z.string(),
});

const flightEntry = z.object({
  kind: z.literal('FLIGHT'),
  search: z.object({
    origin: airportCode,
    destination: airportCode,
    departureDate: isoDate,
    returnDate: z.union([isoDate, z.literal('')]),
    adults: z.number().int().min(1).max(9),
    children: z.number().int().min(0).max(8),
    infants: z.number().int().min(0).max(9),
    cabin: z.enum(Object.keys(CABIN_LABELS) as [Cabin, ...Cabin[]]),
  }),
  originCity: z.string().max(80).optional(),
  destinationCity: z.string().max(80).optional(),
  savedAt: z.string(),
});

const entrySchema = z.discriminatedUnion('kind', [hotelEntry, flightEntry]);

export type RecentHotelSearch = z.infer<typeof hotelEntry>;
export type RecentFlightSearch = z.infer<typeof flightEntry>;
export type RecentSearch = RecentHotelSearch | RecentFlightSearch;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Accessing localStorage itself throws when the browser blocks site data.
    return null;
  }
}

function readRaw(): string | null {
  try {
    return storage()?.getItem(RECENT_SEARCHES_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Valid entries of a stored value, newest first; anything unreadable is dropped. */
export function parseRecentSearches(raw: string | null): RecentSearch[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => entrySchema.safeParse(item))
    .flatMap((result) => (result.success ? [result.data] : []))
    .slice(0, MAX_RECENT_SEARCHES);
}

export function readRecentSearches(): RecentSearch[] {
  return parseRecentSearches(readRaw());
}

function notify() {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // No window (tests without DOM): nothing listens anyway.
  }
}

function write(entries: RecentSearch[]): boolean {
  try {
    const store = storage();
    if (!store) return false;
    if (entries.length === 0) store.removeItem(RECENT_SEARCHES_KEY);
    else store.setItem(RECENT_SEARCHES_KEY, JSON.stringify(entries));
    return true;
  } catch {
    // Full (QuotaExceededError) or blocked: searching still works, it just is not remembered.
    return false;
  } finally {
    notify();
  }
}

/** One entry per place: a new search for Goa (or DEL to BOM) replaces the older one. */
const identity = (entry: RecentSearch) =>
  entry.kind === 'HOTEL'
    ? `H|${entry.destination.trim().toLowerCase()}`
    : `F|${entry.search.origin}|${entry.search.destination}|${entry.search.returnDate ? 'R' : 'O'}`;

function remember(entry: RecentSearch): boolean {
  const parsed = entrySchema.safeParse(entry);
  if (!parsed.success) return false;
  const saved = readRecentSearches();
  let next = parsed.data;
  const previous = saved.find((existing) => identity(existing) === identity(next));
  // A search started from the results page knows only the airport codes: keep the city names saved before.
  if (next.kind === 'FLIGHT' && previous?.kind === 'FLIGHT') {
    next = { ...next, originCity: next.originCity ?? previous.originCity, destinationCity: next.destinationCity ?? previous.destinationCity };
  }
  const others = saved.filter((existing) => identity(existing) !== identity(next));
  return write([next, ...others].slice(0, MAX_RECENT_SEARCHES));
}

/** Called when the hotel search form is submitted. Returns false when the browser could not store it. */
export function recordHotelSearch(destination: string, stay: Stay, now: Date = new Date()): boolean {
  return remember({ kind: 'HOTEL', destination: destination.trim(), stay: { ...stay, childAges: stay.childAges.slice(0, stay.children) }, savedAt: now.toISOString() });
}

/** Called when the flight search form is submitted; the city names (when known) make the list easier to read. */
export function recordFlightSearch(
  search: FlightSearch,
  cities: { origin?: string; destination?: string } = {},
  now: Date = new Date(),
): boolean {
  return remember({
    kind: 'FLIGHT',
    search: { ...search },
    ...(cities.origin ? { originCity: cities.origin } : {}),
    ...(cities.destination ? { destinationCity: cities.destination } : {}),
    savedAt: now.toISOString(),
  });
}

export function clearRecentSearches(): boolean {
  return write([]);
}

/** Forgets one search (the same place, see `identity`). */
export function removeRecentSearch(entry: RecentSearch): boolean {
  return write(readRecentSearches().filter((existing) => identity(existing) !== identity(entry)));
}

/** Puts a list back as it was ("Undo" after removing or clearing); entries are validated again. */
export function restoreRecentSearches(entries: readonly RecentSearch[]): boolean {
  return write(parseRecentSearches(JSON.stringify(entries)));
}

const iso = (date: Date) => format(date, 'yyyy-MM-dd');

/**
 * Dates that are in the past by now move forward, keeping the length of the stay or trip: hotels a week from today,
 * flights two weeks from today (the same defaults as the search forms).
 */
export function freshDates(entry: RecentSearch, today: string = todayIso()): RecentSearch {
  if (entry.kind === 'HOTEL') {
    if (entry.stay.checkIn >= today) return entry;
    const nights = Math.max(1, differenceInCalendarDays(parseISO(entry.stay.checkOut), parseISO(entry.stay.checkIn)));
    const checkIn = addDays(parseISO(today), 7);
    return { ...entry, stay: { ...entry.stay, checkIn: iso(checkIn), checkOut: iso(addDays(checkIn, nights)) } };
  }
  if (entry.search.departureDate >= today) return entry;
  const departure = addDays(parseISO(today), 14);
  const length = entry.search.returnDate
    ? Math.max(0, differenceInCalendarDays(parseISO(entry.search.returnDate), parseISO(entry.search.departureDate)))
    : 0;
  return {
    ...entry,
    search: { ...entry.search, departureDate: iso(departure), returnDate: entry.search.returnDate ? iso(addDays(departure, length)) : '' },
  };
}

/** Where a saved search leads (always our own search pages). */
export function recentSearchPath(entry: RecentSearch, today?: string): string {
  const fresh = freshDates(entry, today);
  return fresh.kind === 'HOTEL'
    ? `/hotels/search?${searchParamsOf({ destination: fresh.destination, stay: fresh.stay, filters: EMPTY_FILTERS }).toString()}`
    : `/flights/search?${flightQueryOf(fresh.search).toString()}`;
}

/** "Goa" + "Thu, 10 Dec – Sat, 12 Dec · 2 adults · 1 room"; flights "Delhi (DEL) to Mumbai (BOM)" + dates and travellers. */
export function describeRecentSearch(entry: RecentSearch, today?: string): { title: string; detail: string } {
  const fresh = freshDates(entry, today);
  if (fresh.kind === 'HOTEL') {
    return {
      title: fresh.destination,
      detail: `${formatShortDate(fresh.stay.checkIn)} – ${formatShortDate(fresh.stay.checkOut)} · ${describeGuests(fresh.stay)}`,
    };
  }
  const { search } = fresh;
  const place = (code: string, city?: string) => (city ? `${city} (${code})` : code);
  const travellers = search.adults + search.children + search.infants;
  const dates = search.returnDate
    ? `${formatShortDate(search.departureDate)} – ${formatShortDate(search.returnDate)}`
    : `${formatShortDate(search.departureDate)} · one way`;
  return {
    title: `${place(search.origin, fresh.originCity)} to ${place(search.destination, fresh.destinationCity)}`,
    detail: `${dates} · ${travellers} traveller${travellers === 1 ? '' : 's'} · ${CABIN_LABELS[search.cabin]}`,
  };
}

export interface RecentSearchSummary {
  /** "Hotel stay", "Flight · One way", "Flight · Round trip". */
  type: string;
  /** The same title as `describeRecentSearch`. */
  title: string;
  /** "Thu, 10 Dec – Sun, 13 Dec" or, one way, "Sun, 22 Nov". */
  dates: string;
  /** "2 adults · 1 room", "3 travellers". */
  people: string;
  /** "3 nights" for a stay, the cabin for a flight. */
  extra: string;
  /** The saved dates had passed and were moved forward (`freshDates`). */
  moved: boolean;
  /** "Searched today", "Searched yesterday", "Searched 3 days ago", "Searched on Sun, 1 Nov"; null when unknown. */
  searched: string | null;
}

/** "Searched today" … from the stored `savedAt` (an ISO time); null when it cannot be read or lies in the future. */
export function searchedAgo(savedAt: string, now: Date = new Date()): string | null {
  const saved = new Date(savedAt);
  if (Number.isNaN(saved.getTime())) return null;
  const days = differenceInCalendarDays(now, saved);
  if (days < 0) return null;
  if (days === 0) return 'Searched today';
  if (days === 1) return 'Searched yesterday';
  if (days < 7) return `Searched ${days} days ago`;
  return `Searched on ${formatShortDate(iso(saved))}`;
}

/** The parts of a saved search for its card (the dates already moved forward like `recentSearchPath`). */
export function summarizeRecentSearch(entry: RecentSearch, today?: string, now: Date = new Date()): RecentSearchSummary {
  const fresh = freshDates(entry, today);
  const { title } = describeRecentSearch(entry, today);
  const searched = searchedAgo(entry.savedAt, now);
  if (fresh.kind === 'HOTEL') {
    const nights = Math.max(1, differenceInCalendarDays(parseISO(fresh.stay.checkOut), parseISO(fresh.stay.checkIn)));
    return {
      type: 'Hotel stay',
      title,
      dates: `${formatShortDate(fresh.stay.checkIn)} – ${formatShortDate(fresh.stay.checkOut)}`,
      people: describeGuests(fresh.stay),
      extra: `${nights} night${nights === 1 ? '' : 's'}`,
      moved: fresh !== entry,
      searched,
    };
  }
  const { search } = fresh;
  const travellers = search.adults + search.children + search.infants;
  return {
    type: search.returnDate ? 'Flight · Round trip' : 'Flight · One way',
    title,
    dates: search.returnDate ? `${formatShortDate(search.departureDate)} – ${formatShortDate(search.returnDate)}` : formatShortDate(search.departureDate),
    people: `${travellers} traveller${travellers === 1 ? '' : 's'}`,
    extra: CABIN_LABELS[search.cabin],
    moved: fresh !== entry,
    searched,
  };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  // Another tab of the same browser saved or cleared searches.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === RECENT_SEARCHES_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** The saved searches, kept up to date when a search is recorded or cleared (also in other tabs). */
export function useRecentSearches(): RecentSearch[] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => parseRecentSearches(raw), [raw]);
}
