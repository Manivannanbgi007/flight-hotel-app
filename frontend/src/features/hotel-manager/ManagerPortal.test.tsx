import { screen, waitFor, within } from '@testing-library/react';
import { Navigate } from 'react-router';

import { RequireRole } from '@/app/guards';
import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { HotelDashboardPage } from './HotelDashboardPage';
import { HotelManagerLayout, MyHotelsPage } from './HotelManagerLayout';
import { HotelReviewsPage } from './HotelReviewsPage';
import { managerApi } from './managerApi';
import { operationsApi } from './operationsApi';
import { dashboardFixture, pageOf, reservationSummaryFixture, reviewFixture, reviewSummaryFixture } from './opsTestData';
import type { HotelSummary } from './types';

vi.mock('./managerApi', () => ({ managerApi: { myHotels: vi.fn() } }));
vi.mock('./operationsApi', () => ({
  operationsApi: { dashboard: vi.fn(), reviews: vi.fn(), reviewSummary: vi.fn(), reservationSummary: vi.fn() },
}));

const manager: AuthUser = { ...customer, id: 'm1', email: 'manager@example.com', roles: ['HOTEL_MANAGER'] };

const hotel = (overrides: Partial<HotelSummary> = {}): HotelSummary => ({
  id: 'h1', name: 'Sea Breeze Resort', slug: 'sea-breeze-resort-goa', city: 'Goa', countryCode: 'IN', status: 'ACTIVE',
  dataSource: 'INTERNAL', starRating: 4, imageUrl: null, roomTypes: 3, totalRooms: 45, managers: 1, updatedAt: '2026-11-01T10:00:00Z', ...overrides,
});

// Same shape as app/router.tsx: the role guard, the portal layout, the hotel pages.
const open = (path: string, user: AuthUser = manager) => renderRoutes([{
  path: '/hotel-manager',
  element: <RequireRole roles={['HOTEL_MANAGER', 'ADMIN']} />,
  children: [{
    element: <HotelManagerLayout />,
    children: [
      { index: true, element: <MyHotelsPage /> },
      { path: 'hotels/:hotelId', element: <Navigate to="dashboard" replace /> },
      { path: 'hotels/:hotelId/dashboard', element: <HotelDashboardPage /> },
      { path: 'hotels/:hotelId/reservations', element: <p>reservations list</p> },
      { path: 'hotels/:hotelId/reservations/:reservationId', element: <p>reservation page</p> },
      { path: 'hotels/:hotelId/reviews', element: <HotelReviewsPage /> },
    ],
  }],
}], { path, auth: fakeAuth({ user }) });

beforeEach(() => {
  vi.mocked(managerApi.myHotels).mockResolvedValue([hotel(), hotel({ id: 'h2', name: 'Hill View Inn', city: 'Shimla' })]);
  vi.mocked(operationsApi.dashboard).mockResolvedValue(dashboardFixture());
  vi.mocked(operationsApi.reviews).mockResolvedValue(pageOf([]));
  vi.mocked(operationsApi.reviewSummary).mockResolvedValue(reviewSummaryFixture());
  vi.mocked(operationsApi.reservationSummary).mockResolvedValue(reservationSummaryFixture());
});

describe('Hotel manager portal', () => {
  it('is closed to customers', () => {
    open('/hotel-manager', customer);

    expect(screen.getByRole('heading', { name: "You don't have access to this page" })).toBeInTheDocument();
    expect(managerApi.myHotels).not.toHaveBeenCalled();
  });

  it('opens a hotel on its dashboard, with the new sections first', async () => {
    const { router } = open('/hotel-manager/hotels/h1');

    await waitFor(() => expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/dashboard'));
    const nav = screen.getByRole('navigation', { name: 'Hotel sections' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent?.trim())).toEqual([
      'Dashboard', 'Reservations', 'Rooms & rates', 'Inventory calendar', 'Reviews', 'Reports', 'Profile', 'Photos',
    ]);
    // The links are grouped: what is happening, what is on sale, guests and numbers, the property.
    for (const title of ['Overview', 'Operations', 'Guests and insight', 'Property']) {
      expect(within(nav).getByText(title)).toBeInTheDocument();
    }
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sea Breeze Resort' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Today at the front desk' })).toBeInTheDocument();
  });

  it('links each of my hotels to its dashboard', async () => {
    open('/hotel-manager');

    expect(await screen.findByRole('link', { name: /Hill View Inn/ })).toHaveAttribute('href', '/hotel-manager/hotels/h2/dashboard');
  });

  it('shows live figures of each hotel from its own dashboard (default range)', async () => {
    vi.mocked(operationsApi.dashboard).mockImplementation(async (hotelId) => (hotelId === 'h1'
      ? dashboardFixture()
      : dashboardFixture({ today: { ...dashboardFixture().today, arrivals: 0, arrivingGuests: 0, occupancyPercent: 10 }, stats: { ...dashboardFixture().stats, revenue: 0 } })));
    open('/hotel-manager');

    const hotels = await screen.findByRole('list', { name: 'Your hotels' });
    const tile = (name: string) => within(hotels).getAllByRole('listitem').find((item) => within(item).queryByRole('heading', { name })) as HTMLElement;
    await waitFor(() => expect(tile('Sea Breeze Resort')).toHaveTextContent('Occupancy tonight72.5%'));
    expect(tile('Sea Breeze Resort')).toHaveTextContent('Arrivals today37 guests');
    expect(tile('Sea Breeze Resort')).toHaveTextContent('Revenue, 30 days₹5,12,340');
    expect(tile('Sea Breeze Resort')).toHaveTextContent('Up 25%');
    await waitFor(() => expect(tile('Hill View Inn')).toHaveTextContent('Occupancy tonight10%'));
    expect(tile('Hill View Inn')).toHaveTextContent('Arrivals today00 guests');
    expect(operationsApi.dashboard).toHaveBeenCalledWith('h1', { preset: 'LAST_30_DAYS', from: '', to: '', interval: null });
    expect(operationsApi.dashboard).toHaveBeenCalledWith('h2', { preset: 'LAST_30_DAYS', from: '', to: '', interval: null });
  });

  it('opens with the portfolio figures of all the hotels, added up from their own dashboards', async () => {
    vi.mocked(operationsApi.reviews).mockResolvedValue(pageOf([reviewFixture({ title: 'Lovely stay by the beach' })]));
    open('/hotel-manager');

    const figures = await screen.findByRole('list', { name: 'Portfolio figures' });
    const card = (label: string) => within(figures).getAllByRole('listitem').find((item) => within(item).queryByText(label, { exact: true })) as HTMLElement;
    await waitFor(() => expect(card('Managed hotels')).toHaveTextContent('2'));
    expect(card('Managed hotels')).toHaveTextContent('2 published');
    await waitFor(() => expect(card('Total rooms')).toHaveTextContent('90'));
    // Two hotels, each 3 arrivals, 2 departures, 29 of 40 rooms booked, 3 reservations waiting for payment.
    await waitFor(() => expect(card('Check-ins today')).toHaveTextContent('6'));
    await waitFor(() => expect(card('Check-outs today')).toHaveTextContent('4'));
    await waitFor(() => expect(card('Occupancy tonight')).toHaveTextContent('72.5%'));
    expect(card('Occupancy tonight')).toHaveTextContent('58 of 80 rooms for sale booked');
    await waitFor(() => expect(card('Waiting for payment')).toHaveTextContent('6'));
    expect(operationsApi.reservationSummary).toHaveBeenCalledWith('h1', expect.objectContaining({ status: '' }));
    expect(operationsApi.reservationSummary).toHaveBeenCalledWith('h2', expect.objectContaining({ status: '' }));
    expect(await screen.findByRole('list', { name: 'Recent reviews' })).toHaveTextContent('Lovely stay by the beach');
  });

  it('says when the figures of a hotel could not be loaded, and leaves it out of the totals', async () => {
    vi.mocked(operationsApi.dashboard).mockImplementation(async (hotelId) => {
      if (hotelId === 'h2') throw new ApiError(500, 'HTTP_500', 'Something went wrong on our side.');
      return dashboardFixture();
    });
    open('/hotel-manager');

    expect(await screen.findByText(/The figures of 1 hotel could not be loaded/)).toBeInTheDocument();
    const figures = screen.getByRole('list', { name: 'Portfolio figures' });
    await waitFor(() => expect(within(figures).getByText('Check-ins today').closest('li')).toHaveTextContent('3'));
  });

  it('says so when no hotel is assigned yet', async () => {
    vi.mocked(managerApi.myHotels).mockResolvedValue([]);
    open('/hotel-manager');

    expect(await screen.findByRole('heading', { name: 'No hotels assigned yet' })).toBeInTheDocument();
    expect(operationsApi.dashboard).not.toHaveBeenCalled();
  });

  it('keeps the section when switching hotels (a reservation goes back to the list)', async () => {
    const { user, router } = open('/hotel-manager/hotels/h1/reservations/r1');
    expect(await screen.findByText('reservation page')).toBeInTheDocument();

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Hotel' }), 'Hill View Inn (Shimla)');

    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h2/reservations');
    expect(within(screen.getByRole('navigation', { name: 'Hotel sections' })).getByRole('link', { name: 'Reservations' }))
      .toHaveAttribute('aria-current', 'page');
  });

  it("shows the hotel's facts, the guest view of a published hotel and the sections as tabs for small screens", async () => {
    open('/hotel-manager/hotels/h1/reviews');

    expect(await screen.findByRole('heading', { level: 1, name: 'Sea Breeze Resort' })).toBeInTheDocument();
    expect(screen.getByText('45 rooms in 3 types')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Guest view of the hotel page (opens in a new tab)' }))
      .toHaveAttribute('href', '/hotels/sea-breeze-resort-goa');
    const tabs = screen.getByRole('navigation', { name: 'Sections of this hotel' });
    expect(within(tabs).getAllByRole('link')).toHaveLength(8);
    expect(within(tabs).getByRole('link', { name: 'Reviews' })).toHaveAttribute('aria-current', 'page');
  });

  it('has no guest view for a hotel that is not published', async () => {
    vi.mocked(managerApi.myHotels).mockResolvedValue([hotel({ status: 'DRAFT' })]);
    open('/hotel-manager/hotels/h1/reviews');

    expect(await screen.findByText('Draft')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Guest view/ })).not.toBeInTheDocument();
  });
});

describe('HotelReviewsPage', () => {
  it('lists the hotel\'s reviews with rating, status and rejection reason (read only)', async () => {
    vi.mocked(operationsApi.reviews).mockResolvedValue(pageOf([
      reviewFixture(),
      reviewFixture({ id: 'rv2', rating: 2, title: 'Noisy room', status: 'REJECTED', rejectionReason: 'Contains personal data.' }),
      reviewFixture({ id: 'rv3', rating: 5, title: 'Perfect', status: 'PENDING', stayedIn: null, bookingReference: null }),
    ]));
    open('/hotel-manager/hotels/h1/reviews');

    const list = await screen.findByRole('list', { name: 'Reviews' });
    const [first, second, third] = within(list).getAllByRole('listitem');
    expect(within(first!).getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument();
    expect(within(first!).getByText('Published')).toBeInTheDocument();
    expect(within(first!).getByText('Asha R.')).toBeInTheDocument();
    expect(within(first!).getByText('stayed in Oct 2026 · booking HT-7K3M9Q2X · written 20 Oct 2026')).toBeInTheDocument();
    expect(within(first!).getByRole('heading', { name: 'Lovely stay by the beach' })).toBeInTheDocument();
    expect(within(second!).getByText('Rejected')).toBeInTheDocument();
    expect(second).toHaveTextContent('Reason for rejection: Contains personal data.');
    expect(within(third!).getByText('Waiting for approval')).toBeInTheDocument();
    expect(within(third!).getByText('written 20 Oct 2026')).toBeInTheDocument();
    // Read only: no moderation actions (the "Rejected" status pill is a filter, not an action).
    expect(screen.queryByRole('button', { name: /\b(Approve|Reject)\b/ })).not.toBeInTheDocument();
    expect(operationsApi.reviews).toHaveBeenCalledWith('h1', { status: '', page: 0, rating: null, sort: 'newest' }, 10);
  });

  it('shows the average, the counts and the charts of the published reviews', async () => {
    open('/hotel-manager/hotels/h1/reviews');

    const figures = await screen.findByRole('list', { name: 'Review figures' });
    const card = (label: string) => within(figures).getAllByRole('listitem').find((item) => within(item).queryByText(label, { exact: true })) as HTMLElement;
    await waitFor(() => expect(card('Average rating')).toHaveTextContent('4.4 / 5'));
    await waitFor(() => expect(card('Total reviews')).toHaveTextContent('10'));
    expect(card('Five-star reviews')).toHaveTextContent('60% of all reviews');
    expect(card('Positive reviews')).toHaveTextContent('80% gave 4 or 5 stars');
    expect(card('Negative reviews')).toHaveTextContent('10% gave 1 or 2 stars');
    expect(card('Waiting for moderation')).toHaveTextContent('2');
    expect(await screen.findByRole('heading', { name: 'Rating distribution' })).toBeInTheDocument();
    const stars = screen.getByRole('list', { name: 'Reviews per star rating' });
    expect(within(stars).getAllByRole('button').map((row) => row.getAttribute('aria-label'))).toEqual([
      '5 stars: 6 reviews, 60%', '4 stars: 2 reviews, 20%', '3 stars: 1 review, 10%', '2 stars: 1 review, 10%', '1 star: 0 reviews, 0%',
    ]);
    // The status pills count the published reviews and the ones waiting for moderation.
    const pills = screen.getByRole('list', { name: 'Reviews by status' });
    expect(within(pills).getByRole('button', { name: /^Published\s*10$/ })).toBeInTheDocument();
    expect(within(pills).getByRole('button', { name: /^Waiting for approval\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rating by month' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reviews by month' })).toBeInTheDocument();
    expect(operationsApi.reviewSummary).toHaveBeenCalledWith('h1');
  });

  it('filters by stars and sorts, both kept in the URL, from the first page', async () => {
    const { user, router } = open('/hotel-manager/hotels/h1/reviews?page=2');
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Rating' }), '5 stars');
    await waitFor(() => expect(operationsApi.reviews).toHaveBeenLastCalledWith('h1', { status: '', page: 0, rating: 5, sort: 'newest' }, 10));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reviews?rating=5');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Lowest rated first');
    await waitFor(() => expect(operationsApi.reviews).toHaveBeenLastCalledWith('h1', { status: '', page: 0, rating: 5, sort: 'lowest' }, 10));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reviews?rating=5&sort=lowest');
    expect(await screen.findByText('No reviews match these filters')).toBeInTheDocument();
  });

  it('filters by status (in the URL) and has an empty state', async () => {
    const { user, router } = open('/hotel-manager/hotels/h1/reviews');
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument();

    const pills = screen.getByRole('list', { name: 'Reviews by status' });
    expect(within(pills).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(pills).getByRole('button', { name: /^Waiting for approval/ }));

    await waitFor(() => expect(operationsApi.reviews).toHaveBeenLastCalledWith('h1', { status: 'PENDING', page: 0, rating: null, sort: 'newest' }, 10));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reviews?status=PENDING');
    expect(within(pills).getByRole('button', { name: /^Waiting for approval/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('No reviews match these filters')).toBeInTheDocument();

    await user.click(within(pills).getByRole('button', { name: 'All' }));
    await waitFor(() => expect(operationsApi.reviews).toHaveBeenLastCalledWith('h1', { status: '', page: 0, rating: null, sort: 'newest' }, 10));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reviews');
  });

  it('filters by a star rating from the distribution, and clears it with the same row', async () => {
    const { user, router } = open('/hotel-manager/hotels/h1/reviews?page=1');
    const stars = await screen.findByRole('list', { name: 'Reviews per star rating' });
    await waitFor(() => expect(within(stars).getByRole('button', { name: /^2 stars: 1 review/ })).toBeInTheDocument());

    await user.click(within(stars).getByRole('button', { name: /^2 stars:/ }));

    await waitFor(() => expect(operationsApi.reviews).toHaveBeenLastCalledWith('h1', { status: '', page: 0, rating: 2, sort: 'newest' }, 10));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reviews?rating=2');
    expect(within(stars).getByRole('button', { name: /^2 stars:/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Rating' })).toHaveValue('2');

    await user.click(within(stars).getByRole('button', { name: /^2 stars:/ }));
    await waitFor(() => expect(operationsApi.reviews).toHaveBeenLastCalledWith('h1', { status: '', page: 0, rating: null, sort: 'newest' }, 10));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reviews');
  });

  it('lists the reviews waiting for moderation from the overview', async () => {
    const { user, router } = open('/hotel-manager/hotels/h1/reviews');

    await user.click(await screen.findByRole('button', { name: 'Show them' }));

    await waitFor(() => expect(operationsApi.reviews).toHaveBeenLastCalledWith('h1', { status: 'PENDING', page: 0, rating: null, sort: 'newest' }, 10));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reviews?status=PENDING');
  });

  it('hides the overview when the summary cannot be loaded, and still lists the reviews', async () => {
    vi.mocked(operationsApi.reviewSummary).mockRejectedValue(new ApiError(500, 'HTTP_500', 'Something went wrong on our side.'));
    vi.mocked(operationsApi.reviews).mockResolvedValue(pageOf([reviewFixture()]));
    open('/hotel-manager/hotels/h1/reviews');

    expect(await screen.findByRole('list', { name: 'Reviews' })).toHaveTextContent('Lovely stay by the beach');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Review figures' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Show them' })).not.toBeInTheDocument();
  });

  it('exports the reviews on screen, and every review matching the same status, rating and sort', async () => {
    const files = stubFileSaving();
    const all = [
      reviewFixture(),
      reviewFixture({ id: 'rv2', rating: 2, title: 'Noisy room', status: 'REJECTED', rejectionReason: 'Contains personal data.' }),
      reviewFixture({ id: 'rv3', rating: 5, title: 'Perfect', stayedIn: null, bookingReference: null }),
    ];
    // The screen asks for 10 a page (2 shown here, 3 in all); the export asks for 100 and gets them all on one page.
    vi.mocked(operationsApi.reviews).mockImplementation(async (_hotelId, filters, size = 10) => (size === 10
      ? { content: all.slice(0, 2), page: filters.page, size, totalElements: 3, totalPages: 2 }
      : { content: all, page: filters.page, size, totalElements: 3, totalPages: 1 }));
    const { user } = open('/hotel-manager/hotels/h1/reviews?status=APPROVED&rating=4&sort=lowest');
    await screen.findByRole('list', { name: 'Reviews' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    let panel = screen.getByRole('dialog', { name: 'Export guest reviews' });
    expect(within(panel).getByText(/The file holds personal data/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect((await files.blobs[0]!.text()).split('\r\n').filter(Boolean)).toEqual([
      '"Rating","Title","Review","Author","Stayed in","Booking reference","Written on","Status","Reason for rejection"',
      '4,"Lovely stay by the beach","Friendly staff and a great breakfast. The room was a bit small.","Asha R.","Oct 2026","HT-7K3M9Q2X",2026-10-20,"Published",',
      '2,"Noisy room","Friendly staff and a great breakfast. The room was a bit small.","Asha R.","Oct 2026","HT-7K3M9Q2X",2026-10-20,"Rejected","Contains personal data."',
    ]);
    expect(files.saved[0]!.fileName).toMatch(/^reviews-sea-breeze-resort-\d{4}-\d{2}-\d{2}\.csv$/);

    await user.click(screen.getByRole('button', { name: 'Export' }));
    panel = screen.getByRole('dialog', { name: 'Export guest reviews' });
    await user.click(within(panel).getByRole('radio', { name: /All matching rows/ }));
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(2));
    expect(operationsApi.reviews).toHaveBeenLastCalledWith('h1', { status: 'APPROVED', page: 0, rating: 4, sort: 'lowest' }, 100);
    expect((await files.blobs[1]!.text()).split('\r\n').filter(Boolean)).toHaveLength(4);
  });

  it('tells a manager when the hotel is not assigned to them', async () => {
    vi.mocked(operationsApi.reviews).mockRejectedValue(new ApiError(403, 'HOTEL_NOT_ASSIGNED', 'Forbidden'));
    open('/hotel-manager/hotels/h9/reviews');

    expect(await screen.findByRole('heading', { name: 'This hotel is not assigned to you' })).toBeInTheDocument();
  });
});
