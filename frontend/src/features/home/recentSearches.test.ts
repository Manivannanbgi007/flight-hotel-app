import { act, renderHook } from '@testing-library/react';

import type { FlightSearch } from '@/features/flights/searchParams';
import type { Stay } from '@/features/hotels/types';
import {
  clearRecentSearches,
  describeRecentSearch,
  freshDates,
  MAX_RECENT_SEARCHES,
  parseRecentSearches,
  readRecentSearches,
  RECENT_SEARCHES_KEY,
  recentSearchPath,
  recordFlightSearch,
  recordHotelSearch,
  removeRecentSearch,
  restoreRecentSearches,
  searchedAgo,
  summarizeRecentSearch,
  useRecentSearches,
} from './recentSearches';

const stay = (overrides: Partial<Stay> = {}): Stay => ({
  checkIn: '2099-03-10', checkOut: '2099-03-12', rooms: 1, adults: 2, children: 0, childAges: [], ...overrides,
});
const flight = (overrides: Partial<FlightSearch> = {}): FlightSearch => ({
  origin: 'DEL', destination: 'BOM', departureDate: '2099-03-10', returnDate: '', adults: 1, children: 0, infants: 0,
  cabin: 'ECONOMY', ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('recent searches storage', () => {
  it('keeps the newest search first and at most five', () => {
    ['Goa', 'Jaipur', 'Mumbai', 'Delhi', 'Kochi', 'Udaipur'].forEach((city) => recordHotelSearch(city, stay()));

    const saved = readRecentSearches();
    expect(saved).toHaveLength(MAX_RECENT_SEARCHES);
    expect(saved.map((entry) => entry.kind === 'HOTEL' && entry.destination)).toEqual(['Udaipur', 'Kochi', 'Delhi', 'Mumbai', 'Jaipur']);
  });

  it('keeps one entry per place: searching Goa again moves it to the top with the new dates', () => {
    recordHotelSearch('Goa', stay());
    recordFlightSearch(flight());
    recordHotelSearch(' goa ', stay({ checkIn: '2099-04-01', checkOut: '2099-04-03' }));

    const saved = readRecentSearches();
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ kind: 'HOTEL', destination: 'goa', stay: { checkIn: '2099-04-01' } });
  });

  it('keeps the city names of a route when the same route is searched again by code only', () => {
    recordFlightSearch(flight(), { origin: 'Delhi', destination: 'Mumbai' });
    recordFlightSearch(flight({ departureDate: '2099-05-01' }));

    expect(readRecentSearches()).toEqual([
      expect.objectContaining({ kind: 'FLIGHT', originCity: 'Delhi', destinationCity: 'Mumbai', search: expect.objectContaining({ departureDate: '2099-05-01' }) }),
    ]);
  });

  it('drops anything it cannot read: broken JSON, other shapes, invalid entries', () => {
    expect(parseRecentSearches('not json')).toEqual([]);
    expect(parseRecentSearches('{"kind":"HOTEL"}')).toEqual([]);
    const good = { kind: 'HOTEL', destination: 'Goa', stay: stay(), savedAt: '2099-01-01T00:00:00Z' };
    const raw = JSON.stringify([
      { kind: 'HOTEL', destination: '', stay: stay(), savedAt: 'x' },
      { kind: 'FLIGHT', search: { ...flight(), origin: 'javascript:' }, savedAt: 'x' },
      { kind: 'OTHER' },
      good,
    ]);
    expect(parseRecentSearches(raw)).toEqual([good]);
  });

  it('clears the list', () => {
    recordHotelSearch('Goa', stay());
    expect(clearRecentSearches()).toBe(true);
    expect(readRecentSearches()).toEqual([]);
    expect(localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });

  it('never throws when the browser refuses storage (full, blocked, private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    expect(recordHotelSearch('Goa', stay())).toBe(false);

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(readRecentSearches()).toEqual([]);
    expect(() => clearRecentSearches()).not.toThrow();
  });

  it('never throws when localStorage itself is not accessible', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
    try {
      expect(recordFlightSearch(flight())).toBe(false);
      expect(readRecentSearches()).toEqual([]);
      expect(clearRecentSearches()).toBe(false);
    } finally {
      Object.defineProperty(window, 'localStorage', original!);
    }
  });
});

describe('recent search links and labels', () => {
  const hotelEntry = { kind: 'HOTEL' as const, destination: 'Goa', stay: stay({ checkIn: '2026-01-10', checkOut: '2026-01-13' }), savedAt: '' };

  it('moves dates that have passed forward and keeps the number of nights', () => {
    const fresh = freshDates(hotelEntry, '2026-11-05');
    expect(fresh).toMatchObject({ stay: { checkIn: '2026-11-12', checkOut: '2026-11-15' } });
    expect(recentSearchPath(hotelEntry, '2026-11-05')).toBe('/hotels/search?destination=Goa&checkIn=2026-11-12&checkOut=2026-11-15&rooms=1&adults=2');

    const roundTrip = { kind: 'FLIGHT' as const, search: flight({ departureDate: '2026-01-10', returnDate: '2026-01-17' }), savedAt: '' };
    expect(freshDates(roundTrip, '2026-11-05')).toMatchObject({ search: { departureDate: '2026-11-19', returnDate: '2026-11-26' } });
    // Future dates stay as they were.
    expect(freshDates({ ...hotelEntry, stay: stay() }, '2026-11-05')).toMatchObject({ stay: { checkIn: '2099-03-10' } });
  });

  it('forgets one search and puts a list back (undo)', () => {
    recordHotelSearch('Goa', stay(), new Date('2099-01-01T10:00:00Z'));
    recordFlightSearch(flight(), {}, new Date('2099-01-02T10:00:00Z'));
    const both = readRecentSearches();

    expect(removeRecentSearch({ ...hotelEntry, destination: ' goa ', stay: stay() })).toBe(true);
    expect(readRecentSearches().map((entry) => entry.kind)).toEqual(['FLIGHT']);
    expect(restoreRecentSearches(both)).toBe(true);
    expect(readRecentSearches()).toEqual(both);
  });

  it('says when a search was made', () => {
    const now = new Date(2099, 2, 10, 15, 0);
    expect(searchedAgo(new Date(2099, 2, 10, 9, 0).toISOString(), now)).toBe('Searched today');
    expect(searchedAgo(new Date(2099, 2, 9, 23, 0).toISOString(), now)).toBe('Searched yesterday');
    expect(searchedAgo(new Date(2099, 2, 6, 12, 0).toISOString(), now)).toBe('Searched 4 days ago');
    expect(searchedAgo(new Date(2099, 1, 20, 12, 0).toISOString(), now)).toBe('Searched on Fri, 20 Feb');
    expect(searchedAgo('not a date', now)).toBeNull();
    expect(searchedAgo(new Date(2099, 2, 11).toISOString(), now)).toBeNull();
  });

  it('splits a search into the parts of its card', () => {
    const now = new Date(2099, 2, 1, 12, 0);
    expect(summarizeRecentSearch({ ...hotelEntry, stay: stay(), savedAt: new Date(2099, 2, 1, 9).toISOString() }, '2099-03-01', now)).toEqual({
      type: 'Hotel stay', title: 'Goa', dates: 'Tue, 10 Mar – Thu, 12 Mar', people: '2 adults · 1 room', extra: '2 nights', moved: false, searched: 'Searched today',
    });
    expect(summarizeRecentSearch({ kind: 'FLIGHT', search: flight({ returnDate: '2099-03-15', adults: 2, cabin: 'BUSINESS' }), originCity: 'Delhi', destinationCity: 'Mumbai', savedAt: '' }, '2099-03-01', now))
      .toEqual({
        type: 'Flight · Round trip', title: 'Delhi (DEL) to Mumbai (BOM)', dates: 'Tue, 10 Mar – Sun, 15 Mar', people: '2 travellers', extra: 'Business',
        moved: false, searched: null,
      });
    // Dates that have passed move forward, and the card says so.
    expect(summarizeRecentSearch({ ...hotelEntry, stay: stay() }, '2099-06-01', now).moved).toBe(true);
  });

  it('describes hotel and flight searches in plain words', () => {
    expect(describeRecentSearch({ ...hotelEntry, stay: stay() })).toEqual({ title: 'Goa', detail: 'Tue, 10 Mar – Thu, 12 Mar · 2 adults · 1 room' });
    expect(describeRecentSearch({ kind: 'FLIGHT', search: flight(), originCity: 'Delhi', destinationCity: 'Mumbai', savedAt: '' })).toEqual({
      title: 'Delhi (DEL) to Mumbai (BOM)', detail: 'Tue, 10 Mar · one way · 1 traveller · Economy',
    });
    expect(describeRecentSearch({ kind: 'FLIGHT', search: flight({ returnDate: '2099-03-15', adults: 2 }), savedAt: '' }).title).toBe('DEL to BOM');
    expect(recentSearchPath({ kind: 'FLIGHT', search: flight(), savedAt: '' })).toBe('/flights/search?origin=DEL&destination=BOM&departureDate=2099-03-10&adults=1');
  });
});

describe('useRecentSearches', () => {
  it('updates when a search is recorded or the list is cleared', () => {
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current).toEqual([]);

    act(() => {
      recordHotelSearch('Goa', stay());
    });
    expect(result.current).toEqual([expect.objectContaining({ destination: 'Goa' })]);

    act(() => {
      clearRecentSearches();
    });
    expect(result.current).toEqual([]);
  });

  it('follows changes made in another tab', () => {
    const { result } = renderHook(() => useRecentSearches());
    act(() => {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify([{ kind: 'HOTEL', destination: 'Jaipur', stay: stay(), savedAt: 'x' }]));
      window.dispatchEvent(new StorageEvent('storage', { key: RECENT_SEARCHES_KEY }));
    });
    expect(result.current).toEqual([expect.objectContaining({ destination: 'Jaipur' })]);
  });
});
