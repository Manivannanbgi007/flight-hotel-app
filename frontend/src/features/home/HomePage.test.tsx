import { screen, waitFor, within } from '@testing-library/react';

import { hotelApi } from '@/features/hotels/hotelApi';
import { offerApi, type Offer } from '@/features/offers/offerApi';
import { reviewApi } from '@/features/reviews/reviewApi';
import type { FeaturedReview } from '@/features/reviews/types';
import { ApiError } from '@/lib/api/apiError';
import { admin, currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { greetingFor } from './greeting';
import { homeApi, type RecommendedHotel } from './homeApi';
import { HomePage } from './HomePage';
import { RECENT_SEARCHES_KEY } from './recentSearches';

vi.mock('./homeApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./homeApi')>()),
  homeApi: { popularDestinations: vi.fn(), popularRoutes: vi.fn(), recommendedHotels: vi.fn() },
}));
vi.mock('@/features/hotels/hotelApi', () => ({ hotelApi: { destinations: vi.fn() } }));
vi.mock('@/features/offers/offerApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/offers/offerApi')>()),
  offerApi: { list: vi.fn() },
}));
vi.mock('@/features/reviews/reviewApi', () => ({ reviewApi: { featured: vi.fn() } }));
vi.mock('@/features/settings/usePublicSettings', () => ({
  usePublicSettings: () => ({ settings: { siteName: 'FlightHotel' }, isLoading: false }),
}));

const offer = (overrides: Partial<Offer> = {}): Offer => ({
  id: 'o1', title: 'Welcome offer', description: '10% off your first booking.', couponCode: 'WELCOME10',
  discountLabel: '10% off, up to ₹1,500', minBookingAmount: 0, appliesTo: 'ALL', destinationCity: null,
  validTo: '2099-12-31T18:29:59Z', seasonal: false, theme: 'OCEAN', demo: true, ...overrides,
});
const hotel = (overrides: Partial<RecommendedHotel> = {}): RecommendedHotel => ({
  id: 'h1', slug: 'sea-breeze-resort-goa', name: 'Sea Breeze Resort', city: 'Goa', starRating: 4, guestRating: 4.6,
  reviewCount: 312, imageUrl: '/api/hotels/images/i1?size=thumb', priceFrom: 5456, demo: true, ...overrides,
});
const featured = (overrides: Partial<FeaturedReview> = {}): FeaturedReview => ({
  id: 'r1', rating: 5, title: 'Perfect beach break', text: 'Great pool and kind staff.', authorName: 'Asha R.', stayedIn: 'Oct 2026',
  createdAt: '2026-10-20T10:00:00Z', hotelName: 'Sea Breeze Resort', hotelSlug: 'sea-breeze-resort-goa', city: 'Goa', ...overrides,
});

const open = (auth = fakeAuth()) => renderRoutes([
  { path: '/customer/home', element: <HomePage /> },
  { path: '/hotels/search', element: <p>hotel results</p> },
  { path: '/flights/search', element: <p>flight results</p> },
  { path: '/hotels/:slug', element: <p>hotel page</p> },
], { path: '/customer/home', auth });
const section = (name: string) => screen.findByRole('region', { name });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(homeApi.popularDestinations).mockResolvedValue([
    { city: 'Goa', bookings: 21 }, { city: 'Jaipur', bookings: 9 }, { city: 'Kochi', bookings: 4 }, { city: 'Mumbai', bookings: 1 },
  ]);
  vi.mocked(homeApi.popularRoutes).mockResolvedValue([
    { origin: 'DEL', destination: 'BOM', originCity: 'Delhi', destinationCity: 'Mumbai', bookings: 12 },
    { origin: 'BOM', destination: 'GOI', originCity: 'Mumbai', destinationCity: 'Goa', bookings: 8 },
    { origin: 'BLR', destination: 'DEL', originCity: 'Bengaluru', destinationCity: 'Delhi', bookings: 5 },
  ]);
  vi.mocked(homeApi.recommendedHotels).mockResolvedValue([hotel(), hotel({ id: 'h2', slug: 'palm-grove', name: 'Palm Grove', imageUrl: null, priceFrom: null })]);
  vi.mocked(hotelApi.destinations).mockResolvedValue([{ city: 'Udaipur', countryCode: 'IN', hotels: 3 }, { city: 'Goa', countryCode: 'IN', hotels: 7 }]);
  vi.mocked(offerApi.list).mockResolvedValue([offer(), offer({ id: 'o2', title: 'Goa monsoon', couponCode: 'GOA15', seasonal: true }),
    offer({ id: 'o3', title: 'Stay and save', couponCode: 'STAY500' }), offer({ id: 'o4', title: 'Fourth offer', couponCode: 'MORE4' })]);
  vi.mocked(reviewApi.featured).mockResolvedValue([featured()]);
});

describe('HomePage', () => {
  it('fills every section from the API', async () => {
    open();

    const destinations = await section('Popular destinations');
    expect(await within(destinations).findByRole('link', { name: /Goa21 bookings recently/ })).toHaveAttribute('href',
      expect.stringMatching(/^\/hotels\/search\?destination=Goa&checkIn=/));
    expect(within(destinations).getByText('Where travellers booked most in the last 90 days.')).toBeInTheDocument();
    expect(hotelApi.destinations).not.toHaveBeenCalled();

    const hotels = await section('Recommended hotels');
    const seaBreeze = await within(hotels).findByRole('link', { name: /Sea Breeze Resort/ });
    expect(seaBreeze).toHaveAttribute('href', '/hotels/sea-breeze-resort-goa');
    expect(seaBreeze.querySelector('img')).toHaveAttribute('src', '/api/hotels/images/i1?size=thumb');
    expect(within(seaBreeze).getByText('₹5,456')).toBeInTheDocument();
    expect(within(hotels).getByRole('link', { name: /Palm Grove/ }).querySelector('img')).toBeNull();

    const routes = await section('Popular flight routes');
    expect(await within(routes).findByRole('link', { name: /Delhi to Mumbai/ })).toHaveAttribute('href',
      expect.stringMatching(/^\/flights\/search\?origin=DEL&destination=BOM&departureDate=/));
    expect(within(routes).queryByText(/Suggested/)).not.toBeInTheDocument();

    const offers = await section('Special offers');
    expect((await within(offers).findByRole('list', { name: 'Special offers' })).children).toHaveLength(3);
    expect(within(offers).getByText('WELCOME10')).toBeInTheDocument();
    expect(within(offers).getByRole('link', { name: 'See all offers' })).toHaveAttribute('href', '/offers');

    const reviews = await section('What guests say');
    expect(await within(reviews).findByText('Perfect beach break')).toBeInTheDocument();
    expect(within(reviews).getByRole('img', { name: '5 out of 5 stars' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'All answers in Help & Support' })).toHaveAttribute('href', '/help');
    // Every image on the page comes from our own API.
    for (const image of document.querySelectorAll('img')) {
      expect(image.getAttribute('src')).toMatch(/^\/api\//);
    }
  });

  it('tops up a short list of popular destinations with cities that have hotels', async () => {
    vi.mocked(homeApi.popularDestinations).mockResolvedValue([{ city: 'Goa', bookings: 2 }]);
    open();

    const destinations = await section('Popular destinations');
    const list = await within(destinations).findByRole('list', { name: 'Destinations' });
    expect(within(list).getAllByRole('link').map((link) => link.textContent)).toEqual(['Goa2 bookings recently', 'Udaipur3 hotels']);
    expect(within(destinations).getByText('Popular right now, and more cities with hotels.')).toBeInTheDocument();
  });

  it('shows the cities with hotels when there are no popular destinations, or they fail', async () => {
    vi.mocked(homeApi.popularDestinations).mockRejectedValue(new ApiError(503, 'HTTP_503', 'Down'));
    open();

    const destinations = await section('Popular destinations');
    expect(await within(destinations).findByRole('link', { name: /Udaipur/ })).toBeInTheDocument();
    expect(within(destinations).getByText('Cities with hotels you can book.')).toBeInTheDocument();
  });

  it('suggests a few routes, labelled as suggestions, when nobody has booked flights yet', async () => {
    vi.mocked(homeApi.popularRoutes).mockResolvedValue([]);
    open();

    const routes = await section('Suggested flight routes');
    const links = await within(routes).findAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(links[0]).toHaveTextContent('Suggested');
    expect(links[0]).toHaveAttribute('href', expect.stringMatching(/^\/flights\/search\?origin=DEL&destination=BOM/));
  });

  it('keeps the page working when a section fails, and retries that section', async () => {
    vi.mocked(offerApi.list).mockRejectedValueOnce(new ApiError(503, 'HTTP_503', 'Down', [], 'corr-7'));
    vi.mocked(homeApi.recommendedHotels).mockRejectedValue(new ApiError(500, 'HTTP_500', 'Down'));
    vi.mocked(reviewApi.featured).mockResolvedValue([]);
    const { user } = open();

    const offers = await section('Special offers');
    expect(await within(offers).findByText('Offers could not be loaded.')).toBeInTheDocument();
    expect(within(offers).getByText('Support reference: corr-7')).toBeInTheDocument();
    expect(await within(await section('Recommended hotels')).findByText('Hotels could not be loaded.')).toBeInTheDocument();
    expect(await within(await section('What guests say')).findByText('No reviews yet')).toBeInTheDocument();
    expect(screen.getByRole('search', { name: 'Search flights' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Hotels' }));
    expect(screen.getByRole('search', { name: 'Search hotels' })).toBeInTheDocument();
    expect(await within(await section('Popular destinations')).findByRole('link', { name: /Goa/ })).toBeInTheDocument();

    await user.click(within(offers).getByRole('button', { name: 'Try again' }));
    expect(await within(offers).findByText('WELCOME10')).toBeInTheDocument();
  });

  it('lists recent searches from this device and clears them', async () => {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify([
      { kind: 'HOTEL', destination: 'Goa', stay: { checkIn: '2099-03-10', checkOut: '2099-03-12', rooms: 1, adults: 2, children: 0, childAges: [] }, savedAt: 'x' },
      { kind: 'FLIGHT', search: { origin: 'DEL', destination: 'BOM', departureDate: '2099-03-10', returnDate: '', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY' },
        originCity: 'Delhi', destinationCity: 'Mumbai', savedAt: 'x' },
    ]));
    const { user } = open();

    const recent = await section('Your recent searches');
    expect(within(recent).getByText('Saved on this device only.')).toBeInTheDocument();
    expect(within(recent).getByRole('link', { name: /Hotels in Goa/ })).toHaveAttribute('href',
      '/hotels/search?destination=Goa&checkIn=2099-03-10&checkOut=2099-03-12&rooms=1&adults=2');
    expect(within(recent).getByRole('link', { name: /Flights: Delhi \(DEL\) to Mumbai \(BOM\)/ })).toBeInTheDocument();

    // Each card says what the search was, beyond its title.
    const goa = within(recent).getByRole('link', { name: /Hotels in Goa/ });
    expect(goa).toHaveTextContent('Hotel stay');
    expect(goa).toHaveTextContent('Tue, 10 Mar – Thu, 12 Mar');
    expect(goa).toHaveTextContent('2 adults · 1 room');
    expect(goa).toHaveTextContent('2 nights');
    expect(goa).toHaveTextContent('Search again');
    expect(within(recent).getByRole('link', { name: /Flights: Delhi/ })).toHaveTextContent('Flight · One way');

    await user.click(within(recent).getByRole('button', { name: 'Clear all recent searches' }));
    expect(screen.queryByRole('region', { name: 'Your recent searches' })).not.toBeInTheDocument();
    expect(localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();

    // "Undo" in the toast brings them back.
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await section('Your recent searches')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')).toHaveLength(2);
  });

  it('removes one recent search, moves the focus to the next one and can undo it', async () => {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify([
      { kind: 'HOTEL', destination: 'Goa', stay: { checkIn: '2099-03-10', checkOut: '2099-03-12', rooms: 1, adults: 2, children: 0, childAges: [] }, savedAt: 'x' },
      { kind: 'HOTEL', destination: 'Jaipur', stay: { checkIn: '2099-04-10', checkOut: '2099-04-11', rooms: 1, adults: 1, children: 0, childAges: [] }, savedAt: 'x' },
    ]));
    const { user } = open();
    const recent = await section('Your recent searches');

    await user.click(within(recent).getByRole('button', { name: 'Remove Goa from recent searches' }));

    expect(within(recent).queryByRole('link', { name: /Hotels in Goa/ })).not.toBeInTheDocument();
    expect(within(recent).getByRole('button', { name: 'Remove Jaipur from recent searches' })).toHaveFocus();
    expect(await screen.findByText('Goa removed from recent searches')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await within(recent).findByRole('link', { name: /Hotels in Goa/ })).toBeInTheDocument();
  });

  it('searches flights first, and opens on hotels when the last search on this device was a hotel search', async () => {
    const first = open();
    expect(await screen.findByRole('tab', { name: 'Flights' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('search', { name: 'Search flights' })).toBeInTheDocument();
    expect(screen.queryByRole('search', { name: 'Search hotels' })).not.toBeInTheDocument();
    first.unmount();

    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify([
      { kind: 'HOTEL', destination: 'Goa', stay: { checkIn: '2099-03-10', checkOut: '2099-03-12', rooms: 1, adults: 2, children: 0, childAges: [] }, savedAt: 'x' },
    ]));
    open();
    expect(await screen.findByRole('tab', { name: 'Hotels' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('search', { name: 'Search hotels' })).toBeInTheDocument();
  });

  it('remembers a hotel search made with the form', async () => {
    const { user, router } = open();
    await section('Popular destinations');

    await user.click(screen.getByRole('tab', { name: 'Hotels' }));
    await user.type(screen.getByLabelText('Destination'), 'Jaipur');
    await user.click(screen.getByRole('button', { name: 'Search hotels' }));

    expect(await screen.findByText('hotel results')).toBeInTheDocument();
    expect(currentLocation(router)).toMatch(/^\/hotels\/search\?destination=Jaipur&/);
    expect(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')).toEqual([expect.objectContaining({ kind: 'HOTEL', destination: 'Jaipur' })]);
  });

  it('still works when the browser blocks storage', async () => {
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    try {
      open();

      expect(await screen.findByRole('heading', { level: 1, name: 'Travel more with FlightHotel' })).toBeInTheDocument();
      expect(await section('Popular destinations')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Your recent searches' })).not.toBeInTheDocument();
    } finally {
      blocked.mockRestore();
    }
  });

  it('tells a visitor what the site is and offers the sign-up and the log-in', async () => {
    open();

    const hero = await screen.findByRole('region', { name: 'Travel more with FlightHotel' });
    expect(within(hero).getByText('Flights and hotels in one place')).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: 'Create a free account' })).toHaveAttribute('href', '/register');
    expect(within(hero).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/customer/login');
    const next = await section('Ready when you are');
    expect(within(next).getByRole('link', { name: 'Create a free account' })).toHaveAttribute('href', '/register');
    expect(within(next).getByRole('link', { name: 'Browse hotels' })).toHaveAttribute('href', '/hotels');
  });

  it('greets a signed-in customer and links their trips and dashboard', async () => {
    open(fakeAuth({ user: customer }));

    const hero = await screen.findByRole('region', { name: 'Travel more with FlightHotel' });
    expect(within(hero).getByText(`${greetingFor(new Date().getHours())}, Asha`)).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: 'My trips' })).toHaveAttribute('href', '/my-trips');
    expect(within(hero).getByRole('link', { name: 'My dashboard' })).toHaveAttribute('href', '/customer/dashboard');
    expect(within(hero).queryByRole('link', { name: 'Create a free account' })).not.toBeInTheDocument();
    const next = await section('Ready when you are');
    expect(within(next).getByRole('link', { name: 'Search flights' })).toHaveAttribute('href', '/flights');
    expect(within(next).getByRole('link', { name: 'View my trips' })).toHaveAttribute('href', '/my-trips');
  });

  it('greets signed-in staff without customer links', async () => {
    open(fakeAuth({ user: admin }));

    const hero = await screen.findByRole('region', { name: 'Travel more with FlightHotel' });
    expect(within(hero).getByText(/, Asha$/)).toBeInTheDocument();
    expect(within(hero).queryAllByRole('link')).toHaveLength(0);
  });

  it('waits for the server before saying there is nothing', async () => {
    vi.mocked(homeApi.popularDestinations).mockReturnValue(new Promise(() => {}));
    open();

    const destinations = await section('Popular destinations');
    await waitFor(() => expect(within(destinations).queryByText('No destinations yet')).not.toBeInTheDocument());
    expect(within(destinations).queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('greetingFor', () => {
  it.each([[0, 'Good morning'], [11, 'Good morning'], [12, 'Good afternoon'], [16, 'Good afternoon'], [17, 'Good evening'], [23, 'Good evening']])(
    'at %i:00 says %s', (hour, greeting) => {
      expect(greetingFor(hour)).toBe(greeting);
    },
  );
});
