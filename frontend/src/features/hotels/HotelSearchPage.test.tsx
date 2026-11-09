import { screen, waitFor, within } from '@testing-library/react';
import { addDays, format } from 'date-fns';

import { ApiError } from '@/lib/api/apiError';
import { currentLocation, renderRoutes } from '@/test/renderRoutes';
import { hotelApi } from './hotelApi';
import { HotelSearchPage } from './HotelSearchPage';
import type { HotelCard, SearchResponse } from './types';

vi.mock('./hotelApi', () => ({ hotelApi: { search: vi.fn(), amenities: vi.fn(), destinations: vi.fn() } }));

const card = (overrides: Partial<HotelCard> = {}): HotelCard => ({
  id: 'h1', slug: 'sea-breeze-resort-goa', name: 'Sea Breeze Resort', propertyType: 'RESORT', starRating: 4, guestRating: 4.4,
  reviewCount: 312, addressLine: 'Beach Road', city: 'Goa', countryCode: 'IN', latitude: 15.5, longitude: 73.7, imageUrl: null,
  amenities: [], available: true, availableRoomTypes: 2, cheapestRoomType: 'Garden View Room', pricePerNight: 5456,
  totalPrice: 11457.6, currency: 'INR', freeCancellation: false, breakfastIncluded: false, distanceKm: null, demo: false, ...overrides,
});

const response = (content: HotelCard[], overrides: Partial<SearchResponse> = {}): SearchResponse => ({
  content, page: 0, size: 10, totalElements: content.length, totalPages: 1, nights: 2,
  destination: { query: 'Goa', city: 'Goa', distanceFrom: 'Goa city centre (Panaji)', latitude: 15.49, longitude: 73.83 },
  facets: { minPrice: 2816, maxPrice: 16280, stars: {}, propertyTypes: {} }, ...overrides,
});

const STAY = 'checkIn=2099-03-10&checkOut=2099-03-12&rooms=1&adults=2';
const open = (query: string) => renderRoutes([{ path: '/hotels/search', element: <HotelSearchPage /> }], { path: `/hotels/search?${query}` });

beforeEach(() => {
  vi.mocked(hotelApi.amenities).mockResolvedValue([]);
  vi.mocked(hotelApi.destinations).mockResolvedValue([]);
});
afterEach(() => localStorage.clear());

describe('HotelSearchPage: more cases', () => {
  it('asks for a destination before searching', async () => {
    open(STAY);

    expect(await screen.findByRole('heading', { name: 'Where are you going?' })).toBeInTheDocument();
    expect(hotelApi.search).not.toHaveBeenCalled();
  });

  it('explains a failed search, with the support reference only for server errors, and retries', async () => {
    vi.mocked(hotelApi.search)
      .mockRejectedValueOnce(new ApiError(503, 'SEARCH_UNAVAILABLE', 'Hotel search is busy. Try again in a moment.', [], 'corr-31'))
      .mockResolvedValueOnce(response([card()]));
    const { user } = open(`destination=Goa&${STAY}`);

    const error = await screen.findByRole('alert');
    expect(within(error).getByRole('heading', { name: 'The search did not work' })).toBeInTheDocument();
    expect(error).toHaveTextContent('Hotel search is busy. Try again in a moment.');
    expect(error).toHaveTextContent('Support reference: corr-31');
    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: 'Sea Breeze Resort' })).toBeInTheDocument();
  });

  it('does not show a support reference for a request the server refused', async () => {
    vi.mocked(hotelApi.search).mockRejectedValue(new ApiError(400, 'INVALID_STAY', 'Check-out must be after check-in.', [], 'corr-32'));
    open(`destination=Goa&${STAY}`);

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Check-out must be after check-in.');
    expect(error).not.toHaveTextContent('Support reference');
  });

  it('shows result-shaped placeholders with a status while the search runs', async () => {
    let finish: (value: SearchResponse) => void = () => undefined;
    vi.mocked(hotelApi.search).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { container } = open(`destination=Goa&${STAY}`);

    expect(await screen.findByRole('status')).toHaveTextContent('Loading hotels…');
    expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Hotels in Goa' })).toBeInTheDocument();

    finish(response([card()]));
    expect(await screen.findByRole('link', { name: 'Sea Breeze Resort' })).toBeInTheDocument();
    expect(screen.queryByText('Loading hotels…')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '1 hotel in Goa' })).toBeInTheDocument();
  });

  it('pages through the results, keeping the page in the URL', async () => {
    vi.mocked(hotelApi.search).mockImplementation(async (search) =>
      response([card({ id: `h${search.filters.page}`, name: `Hotel on page ${search.filters.page + 1}` })],
        { page: search.filters.page, totalPages: 3, totalElements: 25 }));
    const { user, router } = open(`destination=Goa&${STAY}`);

    expect(await screen.findByRole('heading', { name: '25 hotels in Goa' })).toBeInTheDocument();
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(pages).getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(within(pages).getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('link', { name: 'Hotel on page 2' })).toBeInTheDocument();
    expect(currentLocation(router)).toBe(`/hotels/search?destination=Goa&${STAY}&page=1`);
    // "Page 2 of 3" is in the summary line next to the page buttons, the current page is marked in the navigation.
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(within(pages).getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');

    await user.click(within(pages).getByRole('button', { name: 'Previous' }));
    expect(await screen.findByRole('link', { name: 'Hotel on page 1' })).toBeInTheDocument();
    expect(currentLocation(router)).toBe(`/hotels/search?destination=Goa&${STAY}`);
  });

  it('clears the filters of an empty result but keeps the sort order', async () => {
    vi.mocked(hotelApi.search).mockResolvedValue(response([]));
    const { user, router } = open(`destination=Goa&${STAY}&stars=5&freeCancellation=true&sort=PRICE_ASC`);

    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));

    expect(currentLocation(router)).toBe(`/hotels/search?destination=Goa&${STAY}&sort=PRICE_ASC`);
  });

  it('starts a new search on the first page and shows the filters on small screens on request', async () => {
    vi.mocked(hotelApi.search).mockResolvedValue(response([card()], { totalPages: 3, page: 2 }));
    const { user, router } = open(`destination=Goa&${STAY}&page=2`);
    await screen.findByRole('link', { name: 'Sea Breeze Resort' });

    const toggle = screen.getByRole('button', { name: 'Filters' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const checkIn = format(addDays(new Date(), 20), 'yyyy-MM-dd');
    const checkOut = format(addDays(new Date(), 23), 'yyyy-MM-dd');
    const destination = screen.getByRole('combobox', { name: 'Destination' });
    await user.clear(destination);
    await user.type(destination, 'Kochi');
    await user.clear(screen.getByLabelText('Check-in'));
    await user.type(screen.getByLabelText('Check-in'), checkIn);
    await user.clear(screen.getByLabelText('Check-out'));
    await user.type(screen.getByLabelText('Check-out'), checkOut);
    await user.click(screen.getByRole('button', { name: 'Search hotels' }));

    await waitFor(() => expect(currentLocation(router)).toBe(
      `/hotels/search?destination=Kochi&checkIn=${checkIn}&checkOut=${checkOut}&rooms=1&adults=2`));
  });
});
