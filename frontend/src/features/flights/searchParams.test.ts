import { describe, expect, it } from 'vitest';

import {
  activeFilterCount, clearedFlightFilters, defaultFlightSearch, EMPTY_FLIGHT_FILTERS, flightQueryOf, hasActiveFilters, parseFlightSearch,
  searchProblem,
} from './searchParams';

const TODAY = new Date(2027, 0, 1);

describe('flight search params', () => {
  it('starts with a one-way trip two weeks ahead for one adult in economy', () => {
    expect(defaultFlightSearch(TODAY)).toEqual({
      origin: '', destination: '', departureDate: '2027-01-15', returnDate: '', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY',
    });
  });

  it('reads the search and the filters from the URL', () => {
    const params = new URLSearchParams('origin=del&destination=BOM&departureDate=2027-02-10&returnDate=2027-02-14&adults=2&children=1&infants=1&cabin=BUSINESS' +
      '&airlines=AI,6E&maxStops=0&maxPrice=20000&refundable=true&departAfter=06:00&departBefore=12:00&maxDurationMinutes=180&sort=DURATION_ASC');
    const { search, filters } = parseFlightSearch(params, TODAY);

    expect(search).toEqual({ origin: 'DEL', destination: 'BOM', departureDate: '2027-02-10', returnDate: '2027-02-14', adults: 2, children: 1, infants: 1, cabin: 'BUSINESS' });
    expect(filters).toMatchObject({ airlines: ['AI', '6E'], maxStops: 0, maxPrice: 20000, refundable: true, departAfter: '06:00', departBefore: '12:00', maxDurationMinutes: 180, sort: 'DURATION_ASC' });
  });

  it('ignores broken values instead of failing', () => {
    const { search, filters } = parseFlightSearch(new URLSearchParams('origin=DELHI&destination=B&departureDate=tomorrow&cabin=LUXURY&adults=99&sort=NOPE&departAfter=25:00&refundable=maybe&airlines=X,AI'), TODAY);

    expect(search.origin).toBe('');
    expect(search.destination).toBe('');
    expect(search.departureDate).toBe('2027-01-15');
    expect(search.cabin).toBe('ECONOMY');
    expect(search.adults).toBe(1);
    expect(filters.sort).toBe('PRICE_ASC');
    expect(filters.departAfter).toBe('');
    expect(filters.refundable).toBeUndefined();
    expect(filters.airlines).toEqual(['AI']);
  });

  it('keeps travellers within the seat and infant limits', () => {
    const { search } = parseFlightSearch(new URLSearchParams('adults=2&children=8&infants=5'), TODAY);

    expect(search.adults).toBe(2);
    expect(search.children).toBe(7);
    expect(search.infants).toBe(2);
  });

  it('builds the same query for the URL and the API and leaves defaults out', () => {
    const { search, filters } = parseFlightSearch(new URLSearchParams('origin=DEL&destination=BOM&departureDate=2027-02-10'), TODAY);

    expect(flightQueryOf(search, filters).toString()).toBe('origin=DEL&destination=BOM&departureDate=2027-02-10&adults=1');
    const full = flightQueryOf({ ...search, returnDate: '2027-02-12', children: 1, cabin: 'FIRST' },
      { ...EMPTY_FLIGHT_FILTERS, airlines: ['AI'], maxStops: 1, refundable: false, sort: 'PRICE_ASC' });
    expect(full.toString()).toBe('origin=DEL&destination=BOM&departureDate=2027-02-10&returnDate=2027-02-12&adults=1&children=1&cabin=FIRST&airlines=AI&maxStops=1&refundable=false');
  });

  it('round-trips through the URL', () => {
    const query = flightQueryOf(
      { origin: 'DEL', destination: 'DXB', departureDate: '2027-03-01', returnDate: '2027-03-09', adults: 2, children: 0, infants: 1, cabin: 'PREMIUM_ECONOMY' },
      { ...EMPTY_FLIGHT_FILTERS, airlines: ['EK'], departAfter: '18:00', departBefore: '23:59', sort: 'DEPARTURE_ASC' },
    );

    const parsed = parseFlightSearch(query, TODAY);

    expect(flightQueryOf(parsed.search, parsed.filters).toString()).toBe(query.toString());
  });

  it('knows when a filter is active', () => {
    expect(hasActiveFilters(EMPTY_FLIGHT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FLIGHT_FILTERS, sort: 'DURATION_ASC' })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FLIGHT_FILTERS, maxStops: 0 })).toBe(true);
  });

  it('counts the active filter groups (several airlines count once, the sorting not at all)', () => {
    expect(activeFilterCount({ ...EMPTY_FLIGHT_FILTERS, sort: 'DURATION_ASC' })).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FLIGHT_FILTERS, airlines: ['AI', '6E'], maxStops: 0 })).toBe(2);
    expect(activeFilterCount({
      ...EMPTY_FLIGHT_FILTERS, airlines: ['AI'], maxStops: 1, maxPrice: 9000, refundable: false, departAfter: '06:00', departBefore: '12:00',
      arriveAfter: '18:00', arriveBefore: '23:59', maxDurationMinutes: 300,
    })).toBe(7);
  });

  it('clears every filter but keeps the sorting', () => {
    const busy = { ...EMPTY_FLIGHT_FILTERS, airlines: ['AI'], maxStops: 0, maxPrice: 9000, refundable: true, maxDurationMinutes: 300, departAfter: '06:00', departBefore: '12:00' };
    const cleared = { ...busy, ...clearedFlightFilters('DURATION_ASC') };

    expect(hasActiveFilters(cleared)).toBe(false);
    expect(cleared.sort).toBe('DURATION_ASC');
    expect(flightQueryOf(defaultFlightSearch(TODAY), cleared).toString()).toBe('origin=&destination=&departureDate=2027-01-15&adults=1&sort=DURATION_ASC');
  });
});

describe('searchProblem', () => {
  const ok = { origin: 'DEL', destination: 'BOM', departureDate: '2027-01-20', returnDate: '', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY' as const };

  it('accepts a valid search', () => {
    expect(searchProblem(ok, TODAY)).toBeNull();
    expect(searchProblem({ ...ok, returnDate: '2027-01-25' }, TODAY)).toBeNull();
  });

  it.each([
    [{ origin: '' }, 'Choose where you fly from'],
    [{ destination: '' }, 'Choose where you fly to'],
    [{ destination: 'DEL' }, 'The two airports must be different'],
    [{ departureDate: '2026-12-31' }, 'The departure date cannot be in the past'],
    [{ departureDate: '2028-06-01' }, 'Flights can be booked up to 330 days ahead'],
    [{ returnDate: '2027-01-10' }, 'The return date cannot be before the departure date'],
    [{ adults: 1, infants: 2 }, 'Each infant needs an adult (at most one infant per adult)'],
    [{ adults: 5, children: 5 }, 'At most 9 travellers with a seat'],
  ])('refuses %j', (patch, message) => {
    expect(searchProblem({ ...ok, ...patch }, TODAY)).toBe(message);
  });
});
