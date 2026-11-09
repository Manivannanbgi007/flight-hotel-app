import { screen, waitFor, within } from '@testing-library/react';
import { addDays, format } from 'date-fns';

import { reviewApi } from '@/features/reviews/reviewApi';
import { ApiError } from '@/lib/api/apiError';
import { currentLocation, renderRoutes } from '@/test/renderRoutes';
import { hotelApi } from './hotelApi';
import { HotelDetailsPage } from './HotelDetailsPage';
import { HotelSearchPage } from './HotelSearchPage';
import type { HotelCard, HotelDetails, Quote, RoomsResponse, SearchResponse } from './types';

vi.mock('./hotelApi', () => ({
  hotelApi: {
    search: vi.fn(), amenities: vi.fn(), destinations: vi.fn(), details: vi.fn(), rooms: vi.fn(), quote: vi.fn(), getQuote: vi.fn(),
  },
}));
vi.mock('@/features/reviews/reviewApi', () => ({ reviewApi: { forHotel: vi.fn() } }));

const card = (overrides: Partial<HotelCard> = {}): HotelCard => ({
  id: 'h1', slug: 'sea-breeze-resort-goa', name: 'Sea Breeze Resort', propertyType: 'RESORT', starRating: 4, guestRating: 4.4,
  reviewCount: 312, addressLine: 'Beach Road', city: 'Goa', countryCode: 'IN', latitude: 15.5, longitude: 73.7,
  imageUrl: '/api/hotels/images/i1?size=thumb', amenities: ['POOL', 'SPA'], available: true, availableRoomTypes: 2,
  cheapestRoomType: 'Garden View Room', pricePerNight: 5456, totalPrice: 11457.6, currency: 'INR', freeCancellation: true,
  breakfastIncluded: true, distanceKm: 8.9, demo: true, ...overrides,
});

const response = (content: HotelCard[]): SearchResponse => ({
  content, page: 0, size: 10, totalElements: content.length, totalPages: 1, nights: 2,
  destination: { query: 'Goa', city: 'Goa', distanceFrom: 'Goa city centre (Panaji)', latitude: 15.49, longitude: 73.83 },
  facets: { minPrice: 2816, maxPrice: 16280, stars: { 5: 1, 4: 1 }, propertyTypes: { RESORT: 1 } },
});

const SEARCH_URL = '/hotels/search?destination=Goa&checkIn=2099-03-10&checkOut=2099-03-12&rooms=1&adults=2';

describe('HotelSearchPage', () => {
  beforeEach(() => {
    vi.mocked(hotelApi.amenities).mockResolvedValue([
      { code: 'POOL', name: 'Swimming pool', category: 'HOTEL' },
      { code: 'SPA', name: 'Spa', category: 'HOTEL' },
    ]);
    vi.mocked(hotelApi.destinations).mockResolvedValue([]);
  });

  it('shows prices with taxes, distance and the demo label', async () => {
    vi.mocked(hotelApi.search).mockResolvedValue(response([card()]));
    renderRoutes([{ path: '/hotels/search', element: <HotelSearchPage /> }], { path: SEARCH_URL });

    expect(await screen.findByRole('link', { name: 'Sea Breeze Resort' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 hotel in Goa' })).toBeInTheDocument();
    expect(screen.getByText('₹5,456')).toBeInTheDocument();
    expect(screen.getByText(/₹11,458 for 2 nights incl. taxes/)).toBeInTheDocument();
    expect(screen.getByText(/8.9 km from Goa city centre \(Panaji\)/)).toBeInTheDocument();
    expect(screen.getAllByText('Demo listing').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('list', { name: 'Amenities' })).getByText('Swimming pool')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See rooms' })).toHaveAttribute('href',
      '/hotels/sea-breeze-resort-goa?checkIn=2099-03-10&checkOut=2099-03-12&rooms=1&adults=2');
  });

  it('filters and sorting go into the URL and the API call', async () => {
    vi.mocked(hotelApi.search).mockResolvedValue(response([card()]));
    const { user, router } = renderRoutes([{ path: '/hotels/search', element: <HotelSearchPage /> }], { path: `${SEARCH_URL}&page=1` });
    await screen.findByText('Sea Breeze Resort');

    await user.click(screen.getByRole('checkbox', { name: /^5 stars/ }));
    expect(currentLocation(router)).toContain('stars=5');
    expect(currentLocation(router)).not.toContain('page=');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'PRICE_ASC');
    await user.click(screen.getByRole('checkbox', { name: 'Free cancellation' }));

    expect(currentLocation(router)).toContain('sort=PRICE_ASC');
    expect(currentLocation(router)).toContain('freeCancellation=true');
    const lastCall = vi.mocked(hotelApi.search).mock.calls.at(-1)?.[0];
    expect(lastCall?.filters).toMatchObject({ stars: [5], sort: 'PRICE_ASC', freeCancellation: true, page: 0 });
  });

  it('marks hotels that are full and explains an empty result', async () => {
    vi.mocked(hotelApi.search).mockResolvedValueOnce(response([card({ available: false, pricePerNight: null, totalPrice: null })]));
    renderRoutes([{ path: '/hotels/search', element: <HotelSearchPage /> }], { path: `${SEARCH_URL}&showUnavailable=true` });
    expect(await screen.findByText('Not available for your dates')).toBeInTheDocument();
  });

  it('shows a helpful empty state', async () => {
    vi.mocked(hotelApi.search).mockResolvedValue(response([]));
    renderRoutes([{ path: '/hotels/search', element: <HotelSearchPage /> }], { path: `${SEARCH_URL}&stars=1` });
    expect(await screen.findByRole('heading', { name: 'No hotels match' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});

describe('HotelDetailsPage', () => {
  const details: HotelDetails = {
    id: 'h1', slug: 'sea-breeze-resort-goa', name: 'Sea Breeze Resort', description: 'A relaxed beach resort.',
    propertyType: 'RESORT', starRating: 4, guestRating: 4.4, reviewCount: 312, addressLine: 'Beach Road', city: 'Goa',
    state: 'Goa', countryCode: 'IN', postalCode: null, latitude: 15.54, longitude: 73.76, checkInTime: '14:00:00',
    checkOutTime: '11:00:00', timeZone: 'Asia/Kolkata', amenities: [{ code: 'POOL', name: 'Swimming pool', category: 'HOTEL' }],
    policies: [{ type: 'PETS', description: 'No pets.' }], images: [], roomTypes: [],
    nearby: [{ name: 'Calangute Beach', type: 'BEACH', distanceKm: 0.8 }], demo: true,
  };
  const rooms: RoomsResponse = {
    hotelId: 'h1', checkIn: '2099-03-10', checkOut: '2099-03-12', nights: 2, rooms: 1, adults: 2, children: 0,
    roomTypes: [{
      roomType: { id: 'r1', name: 'Garden View Room', description: null, maxAdults: 2, maxChildren: 1, bedConfiguration: '1 King bed',
        sizeSqm: 28, amenities: [], images: [] },
      fitsParty: true, freeRooms: 5, available: true,
      rates: [{
        ratePlanId: 'p1', name: 'Saver (non-refundable)', breakfastIncluded: false, refundable: false, freeCancellation: false,
        freeCancellationUntil: null, cancellationPolicy: 'Non-refundable: the full amount is charged if you cancel.',
        pricePerNight: 5456, subtotal: 10912, taxes: 545.6, total: 11457.6, currency: 'INR',
        nights: [{ date: '2099-03-10', price: 5456, season: null }, { date: '2099-03-11', price: 5456, season: null }],
      }],
    }],
  };

  beforeEach(() => {
    vi.mocked(reviewApi.forHotel).mockResolvedValue({
      content: [{ id: 'rv1', rating: 5, title: 'Lovely stay', text: 'Great pool.', authorName: 'Asha R.', stayedIn: 'Oct 2026', createdAt: '2026-10-20T10:00:00Z' }],
      page: 0, size: 5, totalElements: 12, totalPages: 3, summary: { average: 4.4, count: 12, distribution: { 5: 8, 4: 4 } },
    });
  });

  it('shows the hotel, its location and books a quote for the chosen rate', async () => {
    vi.mocked(hotelApi.details).mockResolvedValue(details);
    vi.mocked(hotelApi.rooms).mockResolvedValue(rooms);
    vi.mocked(hotelApi.quote).mockResolvedValue({ quoteId: 'q1' } as Quote);
    const { user, router } = renderRoutes([
      { path: '/hotels/:slug', element: <HotelDetailsPage /> },
      { path: '/hotels/quote/:quoteId', element: <p>quote page</p> },
    ], { path: '/hotels/sea-breeze-resort-goa?checkIn=2099-03-10&checkOut=2099-03-12&rooms=1&adults=2' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Sea Breeze Resort' })).toBeInTheDocument();
    expect(screen.getByTitle('Map showing Sea Breeze Resort')).toHaveAttribute('src', expect.stringContaining('openstreetmap.org/export/embed.html'));
    expect(screen.getByText('Calangute Beach')).toBeInTheDocument();
    expect(screen.getByText('No pets.')).toBeInTheDocument();
    const reviews = screen.getByRole('region', { name: 'Guest reviews' });
    expect(await within(reviews).findByText('12 reviews')).toBeInTheDocument();
    expect(within(reviews).getByRole('article', { name: 'Lovely stay' })).toBeInTheDocument();
    expect(reviewApi.forHotel).toHaveBeenCalledWith('sea-breeze-resort-goa', { page: 0, size: 5, sort: 'RECENT' });

    const reserve = await screen.findByRole('button', { name: 'Reserve Garden View Room, Saver (non-refundable)' });
    const offer = reserve.closest('div')?.parentElement as HTMLElement;
    expect(within(offer).getByText('₹11,458')).toBeInTheDocument();
    await user.click(reserve);

    expect(await screen.findByText('quote page')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/hotels/quote/q1');
    expect(vi.mocked(hotelApi.quote).mock.calls[0]?.[0]).toEqual({
      hotelId: 'h1', roomTypeId: 'r1', ratePlanId: 'p1',
      stay: { checkIn: '2099-03-10', checkOut: '2099-03-12', rooms: 1, adults: 2, children: 0, childAges: [] },
    });
  });

  it('explains a room that was sold out meanwhile', async () => {
    vi.mocked(hotelApi.details).mockResolvedValue(details);
    vi.mocked(hotelApi.rooms).mockResolvedValue(rooms);
    vi.mocked(hotelApi.quote).mockRejectedValue(new ApiError(409, 'ROOMS_NOT_AVAILABLE', 'These rooms are no longer available for your dates.'));
    const { user } = renderRoutes([{ path: '/hotels/:slug', element: <HotelDetailsPage /> }],
      { path: '/hotels/sea-breeze-resort-goa?checkIn=2099-03-10&checkOut=2099-03-12' });

    await user.click(await screen.findByRole('button', { name: /^Reserve Garden View Room/ }));

    expect(await screen.findByText(/no longer available for your dates/)).toBeInTheDocument();
    expect(hotelApi.rooms).toHaveBeenCalledTimes(2);
  });

  const openDetails = (query = '?checkIn=2099-03-10&checkOut=2099-03-12&rooms=1&adults=2') => renderRoutes([
    { path: '/hotels/:slug', element: <HotelDetailsPage /> },
  ], { path: `/hotels/sea-breeze-resort-goa${query}` });

  it('shows "page not found" for an unknown hotel', async () => {
    vi.mocked(hotelApi.details).mockRejectedValue(new ApiError(404, 'HOTEL_NOT_FOUND', 'Not found.'));
    openDetails();

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(hotelApi.rooms).not.toHaveBeenCalled();
  });

  it('offers a retry with the support reference when the hotel cannot be loaded', async () => {
    vi.mocked(hotelApi.details)
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hotel service is not reachable.', [], 'corr-5'))
      .mockResolvedValueOnce(details);
    vi.mocked(hotelApi.rooms).mockResolvedValue(rooms);
    const { user } = openDetails();

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Hotel service is not reachable.');
    expect(error).toHaveTextContent('Support reference: corr-5');
    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Sea Breeze Resort' })).toBeInTheDocument();
  });

  it('switches the large photo from the thumbnails', async () => {
    vi.mocked(hotelApi.details).mockResolvedValue({ ...details, images: [
      { id: 'i1', url: '/img/1', thumbUrl: '/img/1?size=thumb', caption: 'Beach view', roomTypeId: null, width: 1600, height: 1067 },
      { id: 'i2', url: '/img/2', thumbUrl: '/img/2?size=thumb', caption: null, roomTypeId: null, width: 1600, height: 1067 },
    ] });
    vi.mocked(hotelApi.rooms).mockResolvedValue(rooms);
    const { user } = openDetails();

    const photos = await screen.findByRole('region', { name: 'Photos' });
    expect(within(photos).getByRole('img', { name: 'Beach view' })).toHaveAttribute('src', '/img/1');
    expect(within(photos).getByRole('button', { name: 'Show photo 1: Beach view' })).toHaveAttribute('aria-current', 'true');

    await user.click(within(photos).getByRole('button', { name: /^Show photo 2/ }));

    // A photo without a caption is described by the hotel name.
    expect(within(photos).getByRole('img', { name: 'Sea Breeze Resort' })).toHaveAttribute('src', '/img/2');
    expect(within(photos).getByRole('button', { name: /^Show photo 2/ })).toHaveAttribute('aria-current', 'true');
  });

  it('explains rooms that cannot be booked for this party or these dates, and seasonal prices', async () => {
    const rate = rooms.roomTypes[0]!.rates[0]!;
    vi.mocked(hotelApi.details).mockResolvedValue(details);
    vi.mocked(hotelApi.rooms).mockResolvedValue({ ...rooms, rooms: 2, nights: 1, roomTypes: [
      {
        roomType: { id: 'r2', name: 'Single Room', description: 'A compact room for one.', maxAdults: 1, maxChildren: 0,
          bedConfiguration: '1 Single bed', sizeSqm: null, amenities: [{ code: 'TV', name: 'Television', category: 'ROOM' }], images: [] },
        fitsParty: false, freeRooms: 3, available: false, rates: [{ ...rate, ratePlanId: 'p2', name: 'Room only' }],
      },
      {
        roomType: { ...rooms.roomTypes[0]!.roomType, id: 'r3', name: 'Family Suite', maxChildren: 2 },
        fitsParty: true, freeRooms: 0, available: false,
        rates: [{ ...rate, ratePlanId: 'p3', name: 'Flexible', breakfastIncluded: true, freeCancellation: true,
          nights: [{ date: '2099-03-10', price: 6000, season: 'Holi' }, { date: '2099-03-11', price: 6000, season: 'Holi' }] }],
      },
    ] });
    openDetails('?checkIn=2099-03-10&checkOut=2099-03-11&rooms=2&adults=2');

    expect(await screen.findByText('Does not fit your party in 2 rooms')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reserve Single Room, Room only' })).toBeDisabled();
    expect(screen.getByText('Up to 1 adult')).toBeInTheDocument();
    expect(screen.getByText('A compact room for one.')).toBeInTheDocument();
    expect(screen.getByText('Television')).toBeInTheDocument();

    expect(screen.getByText('Sold out for your dates')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reserve Family Suite, Flexible' })).toBeDisabled();
    expect(screen.getByText('Up to 2 adults + 2 children')).toBeInTheDocument();
    expect(screen.getByText('Includes seasonal prices (Holi)')).toBeInTheDocument();
    expect(screen.getAllByText('1 night, 2 rooms')).toHaveLength(2);
  });

  it('retries prices that could not be loaded and says when no rooms are on sale', async () => {
    vi.mocked(hotelApi.details).mockResolvedValue(details);
    vi.mocked(hotelApi.rooms)
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Live prices are not available right now.'))
      .mockResolvedValueOnce({ ...rooms, roomTypes: [] });
    const { user } = openDetails();

    const error = await screen.findByRole('alert');
    expect(within(error).getByRole('heading', { name: 'Prices could not be loaded' })).toBeInTheDocument();
    expect(error).toHaveTextContent('Live prices are not available right now.');
    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'No rooms on sale' })).toBeInTheDocument();
  });

  it('checks the new stay, then updates the prices for it and keeps the stay in the URL', async () => {
    const daysAhead = (days: number) => format(addDays(new Date(), days), 'yyyy-MM-dd');
    vi.mocked(hotelApi.details).mockResolvedValue(details);
    vi.mocked(hotelApi.rooms).mockResolvedValue(rooms);
    const { user, router } = openDetails();
    await screen.findByRole('button', { name: /^Reserve Garden View Room/ });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Adults' }), '3');
    await user.click(screen.getByRole('button', { name: 'Update prices' }));

    // The stay of the link is more than a year ahead: same rule as the API.
    expect(await screen.findByText('Rooms can be booked up to one year ahead')).toBeInTheDocument();
    expect(currentLocation(router)).toContain('adults=2');

    const checkIn = daysAhead(30);
    const checkOut = daysAhead(32);
    await user.clear(screen.getByLabelText('Check-in'));
    await user.type(screen.getByLabelText('Check-in'), checkIn);
    await user.clear(screen.getByLabelText('Check-out'));
    await user.type(screen.getByLabelText('Check-out'), checkOut);
    await user.click(screen.getByRole('button', { name: 'Update prices' }));

    const stay = `checkIn=${checkIn}&checkOut=${checkOut}&rooms=1&adults=3`;
    await waitFor(() => expect(currentLocation(router)).toBe(`/hotels/sea-breeze-resort-goa?${stay}`));
    await waitFor(() => expect(hotelApi.rooms).toHaveBeenLastCalledWith('h1', expect.objectContaining({ checkIn, adults: 3 })));
    expect(screen.getByRole('link', { name: 'Hotels in Goa' })).toHaveAttribute('href', `/hotels/search?destination=Goa&${stay}`);
  });
});
