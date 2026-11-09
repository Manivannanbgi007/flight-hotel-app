import { apiQueryOf, describeGuests, parseSearch, parseStay, searchParamsOf, withFilters } from './searchParams';

const TODAY = new Date(2027, 2, 1); // 1 Mar 2027

describe('hotel search URL', () => {
  it('round-trips every filter', () => {
    const url = new URLSearchParams(
      'destination=Goa&checkIn=2027-03-10&checkOut=2027-03-12&rooms=2&adults=3&children=1&childAges=7'
      + '&minPrice=2000&maxPrice=9000&stars=5,4&minGuestRating=4.5&amenities=SPA,POOL&propertyTypes=RESORT'
      + '&freeCancellation=true&breakfastIncluded=true&maxDistanceKm=5&showUnavailable=true&sort=PRICE_ASC&page=2',
    );
    const search = parseSearch(url, TODAY);

    expect(search).toEqual({
      destination: 'Goa',
      stay: { checkIn: '2027-03-10', checkOut: '2027-03-12', rooms: 2, adults: 3, children: 1, childAges: [7] },
      filters: {
        minPrice: 2000, maxPrice: 9000, stars: [5, 4], minGuestRating: 4.5, amenities: ['SPA', 'POOL'],
        propertyTypes: ['RESORT'], freeCancellation: true, breakfastIncluded: true, maxDistanceKm: 5,
        showUnavailable: true, sort: 'PRICE_ASC', page: 2,
      },
    });
    expect(parseSearch(searchParamsOf(search), TODAY)).toEqual({
      ...search,
      filters: { ...search.filters, stars: [4, 5], amenities: ['POOL', 'SPA'] },
    });
  });

  it('keeps links short by leaving out defaults', () => {
    const search = parseSearch(new URLSearchParams('destination=Goa&checkIn=2027-03-10&checkOut=2027-03-12'), TODAY);
    expect(searchParamsOf(search).toString()).toBe('destination=Goa&checkIn=2027-03-10&checkOut=2027-03-12&rooms=1&adults=2');
  });

  it('repairs broken or hostile values instead of failing', () => {
    const search = parseSearch(new URLSearchParams(
      'destination=%20Goa%20&checkIn=2027-03-10&checkOut=2027-03-01&rooms=99&adults=0&stars=9,x,3'
      + '&amenities=POOL,%3Cscript%3E&propertyTypes=CASTLE&sort=DROP&page=-1&minPrice=abc',
    ), TODAY);

    expect(search.destination).toBe('Goa');
    expect(search.stay).toMatchObject({ checkIn: '2027-03-10', checkOut: '2027-03-11', rooms: 1, adults: 2 });
    expect(search.filters).toMatchObject({ stars: [3], amenities: ['POOL'], propertyTypes: [], sort: 'RECOMMENDED', page: 0 });
    expect(search.filters.minPrice).toBeUndefined();
  });

  it('defaults to a stay one week ahead', () => {
    expect(parseStay(new URLSearchParams(), TODAY)).toEqual({
      checkIn: '2027-03-08', checkOut: '2027-03-10', rooms: 1, adults: 2, children: 0, childAges: [],
    });
  });

  it('every adult room count is at least the number of rooms', () => {
    expect(parseStay(new URLSearchParams('rooms=3&adults=1'), TODAY)).toMatchObject({ rooms: 3, adults: 3 });
  });

  it('asks the API for available hotels unless unavailable ones are wanted', () => {
    const search = parseSearch(new URLSearchParams('destination=Goa&checkIn=2027-03-10&checkOut=2027-03-12'), TODAY);
    expect(apiQueryOf(search, 10).get('availableOnly')).toBe('true');
    expect(apiQueryOf(withFilters(search, { showUnavailable: true })).get('availableOnly')).toBe('false');
    expect(apiQueryOf(search, 10).get('size')).toBe('10');
  });

  it('a filter change goes back to the first page', () => {
    const search = parseSearch(new URLSearchParams('destination=Goa&page=3'), TODAY);
    expect(withFilters(search, { stars: [5] }).filters).toMatchObject({ page: 0, stars: [5] });
  });

  it('describes the party', () => {
    expect(describeGuests({ rooms: 1, adults: 2, children: 0 })).toBe('2 adults · 1 room');
    expect(describeGuests({ rooms: 2, adults: 1, children: 3 })).toBe('1 adult, 3 children · 2 rooms');
  });
});
