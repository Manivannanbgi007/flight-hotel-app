import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { HotelDashboardPage } from './HotelDashboardPage';
import { operationsApi } from './operationsApi';
import { dashboardFixture, reservationRow, reservationSummaryFixture } from './opsTestData';

vi.mock('./operationsApi', () => ({ operationsApi: { dashboard: vi.fn(), reservationSummary: vi.fn() } }));

const manager: AuthUser = { ...customer, id: 'm1', email: 'manager@example.com', roles: ['HOTEL_MANAGER'] };

const open = (path = '/hotel-manager/hotels/h1/dashboard') => renderRoutes([
  { path: '/hotel-manager/hotels/:hotelId/dashboard', element: <HotelDashboardPage /> },
  { path: '/hotel-manager/hotels/:hotelId/reservations/:reservationId', element: <p>reservation page</p> },
  { path: '/hotel-manager/hotels/:hotelId/reviews', element: <p>reviews page</p> },
  { path: '/hotel-manager', element: <p>my hotels</p> },
], { path, auth: fakeAuth({ user: manager }) });

const DEFAULT = { preset: 'LAST_30_DAYS', from: '', to: '', interval: null };

/** A white figure of the "today" band (label, value, note). */
const figure = (region: HTMLElement, label: string) => within(region).getByText(label, { exact: true }).parentElement as HTMLElement;
/** The KPI card in `region` whose label is `label`. */
const card = (region: HTMLElement, label: string) =>
  within(region).getAllByRole('listitem').find((item) => within(item).queryByText(label, { exact: true })) as HTMLElement;
/** Waits until the figures are there (the band exists while loading too). */
const loaded = () => screen.findByRole('list', { name: 'Rooms and revenue' }).then(() => screen.findByText('Rooms booked on those nights'));

beforeAll(async () => {
  await import('@/components/charts/impl/rechartsPlots');
}, 60_000);

beforeEach(() => {
  vi.mocked(operationsApi.dashboard).mockResolvedValue(dashboardFixture());
  vi.mocked(operationsApi.reservationSummary).mockResolvedValue(reservationSummaryFixture());
});

describe('HotelDashboardPage', () => {
  it('shows the rooms behind tonight\'s occupancy and the reservations by status', async () => {
    open();
    await loaded();

    const today = screen.getByRole('region', { name: 'Today at the front desk' });
    expect(figure(today, 'Occupancy tonight')).toHaveTextContent('29 of 40 rooms for sale booked');
    expect(await screen.findByRole('heading', { name: 'Rooms tonight' })).toBeInTheDocument();
    expect(screen.getByText('45 rooms across the hotel’s room types')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Reservations by status' })).toBeInTheDocument();
    expect(operationsApi.reservationSummary).toHaveBeenCalledWith('h1', expect.objectContaining({ status: '', q: '' }));
  });

  it("shows today's front desk with guests and rooms, and the next arrivals", async () => {
    const { user, router } = open();
    await loaded();

    const today = screen.getByRole('region', { name: 'Today at the front desk' });
    expect(today).toHaveTextContent('5 Nov 2026');
    expect(figure(today, 'Arriving')).toHaveTextContent('3');
    expect(figure(today, 'Arriving')).toHaveTextContent('7 guests');
    expect(figure(today, 'Departing')).toHaveTextContent('4 guests');
    expect(figure(today, 'In-house guests')).toHaveTextContent('23');
    expect(figure(today, 'In-house guests')).toHaveTextContent('12 rooms · 11 reservations');
    expect(figure(today, 'Occupancy tonight')).toHaveTextContent('72.5%');

    // The band links to the reservation list filtered to today's check-ins.
    expect(within(today).getByRole('link', { name: 'Today’s arrivals' }))
      .toHaveAttribute('href', '/hotel-manager/hotels/h1/reservations?from=2026-11-05&to=2026-11-05&sort=checkIn%2Casc');

    const arrivals = screen.getByRole('list', { name: 'Upcoming arrivals' });
    await user.click(within(arrivals).getByRole('link', { name: 'Asha Rao' }));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reservations/r1');
  });

  it('shows occupancy, ADR, RevPAR, revenue, room nights, bookings and ratings against the previous period', async () => {
    open();
    await loaded();

    const rooms = screen.getByRole('region', { name: 'Rooms and revenue' });
    expect(card(rooms, 'Occupancy')).toHaveTextContent('64%');
    // A rate changes in percentage points.
    expect(card(rooms, 'Occupancy')).toHaveTextContent('−2.5 pp');
    expect(card(rooms, 'Occupancy')).toHaveTextContent('Down 2.5 percentage points');
    expect(card(rooms, 'Occupancy')).toHaveTextContent('96 of 150 room nights booked');
    expect(card(rooms, 'Revenue')).toHaveTextContent('₹5,12,340');
    expect(card(rooms, 'Revenue')).toHaveTextContent('Up 25%');
    expect(card(rooms, 'Average daily rate (ADR)')).toHaveTextContent('₹5,337');
    expect(card(rooms, 'Average daily rate (ADR)')).toHaveTextContent('No change, 0%');
    expect(card(rooms, 'RevPAR')).toHaveTextContent('₹3,415.60');
    // Nothing in the previous period: "New", never ∞.
    expect(card(rooms, 'RevPAR')).toHaveTextContent('New: nothing in the previous period');
    expect(within(rooms).getByText('Available room nights').closest('div')).toHaveTextContent('150');
    expect(within(rooms).getByText('Booked room nights').closest('div')).toHaveTextContent('96');
    expect(within(rooms).getByText('Sold room nights').closest('div')).toHaveTextContent('96Rooms sold · previous period 80');

    const bookings = screen.getByRole('region', { name: 'Reservations and cancellations' });
    expect(card(bookings, 'Reservations')).toHaveTextContent('40');
    expect(card(bookings, 'Reservations')).toHaveTextContent('Up 25%');
    expect(card(bookings, 'Cancellations')).toHaveTextContent('By guests 2 · by the hotel 1');
    // Fewer cancellations is good news.
    expect(within(card(bookings, 'Cancellations')).getByText('Down', { exact: false }).parentElement).toHaveClass('bg-success-50');
    expect(card(bookings, 'Cancellation rate')).toHaveTextContent('5%');
    expect(card(bookings, 'Cancellation rate')).toHaveTextContent('2 reservations of 40 booked in the range cancelled since');

    const ratings = screen.getByRole('region', { name: 'Guest ratings' });
    expect(card(ratings, 'Guest rating')).toHaveTextContent('4.2 / 5');
    expect(card(ratings, 'Guest rating')).toHaveTextContent('120 reviews');
    expect(card(ratings, 'New reviews')).toHaveTextContent('4');
    expect(card(ratings, 'New reviews')).toHaveTextContent('Average 4.5 / 5');
    expect(within(ratings).getByRole('link', { name: /Waiting for moderation/ })).toHaveAttribute('href', '/hotel-manager/hotels/h1/reviews?status=PENDING');

    expect(screen.getByText(/compared with 7 Sep – 6 Oct 2026/)).toBeInTheDocument();
    expect(operationsApi.dashboard).toHaveBeenCalledWith('h1', DEFAULT);
  });

  it('draws the revenue, occupancy and booking trends with summaries', async () => {
    open();
    await loaded();

    expect(await screen.findByRole('img', { name: /^Revenue per day, 4 Nov to 5 Nov\. Revenue: ₹3,97,500 in total, highest ₹2,47,500 on 5 Nov\./ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Occupancy per day, 4 Nov to 5 Nov\. Occupancy: .*highest 75% on 5 Nov/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^ADR and RevPAR per day.*ADR: .*RevPAR: / })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Reservations and cancellations per day.*Reservations: 5 in total.*Cancellations: 1 in total/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cancellations by who cancelled, 3 in total. By the guest: 2 (66.7%). By the hotel: 1 (33.3%).' })).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Revenue per day' })).getAllByRole('row').map((row) => row.textContent))
      .toEqual(['DateRevenue', '4 Nov₹1,50,000', '5 Nov₹2,47,500']);
  });

  it('says so when nobody arrives in the next 7 days', async () => {
    vi.mocked(operationsApi.dashboard).mockResolvedValue(dashboardFixture({ upcomingArrivals: [] }));
    open();

    expect(await screen.findByText('No arrivals in the next 7 days.')).toBeInTheDocument();
  });

  it('keeps the chosen range and interval in the URL', async () => {
    const { user, router } = open();
    await loaded();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Date range' }), 'This year');
    await waitFor(() => expect(operationsApi.dashboard).toHaveBeenLastCalledWith('h1', { ...DEFAULT, preset: 'THIS_YEAR' }));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/dashboard?range=THIS_YEAR');

    await user.click(screen.getByRole('radio', { name: 'Week' }));
    await waitFor(() => expect(operationsApi.dashboard).toHaveBeenLastCalledWith('h1', { ...DEFAULT, preset: 'THIS_YEAR', interval: 'WEEK' }));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/dashboard?range=THIS_YEAR&interval=WEEK');
  });

  it('reads the range from the URL', async () => {
    open('/hotel-manager/hotels/h1/dashboard?range=CUSTOM&from=2026-10-01&to=2026-10-15&interval=DAY');

    await waitFor(() => expect(operationsApi.dashboard).toHaveBeenCalledWith('h1', { preset: 'CUSTOM', from: '2026-10-01', to: '2026-10-15', interval: 'DAY' }));
    expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveValue('CUSTOM');
  });

  it('checks custom dates before using them (at most five years)', async () => {
    const { user, router } = open();
    await loaded();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Date range' }), 'Custom dates');
    const form = screen.getByRole('form', { name: 'Custom dates' });
    fireEvent.change(within(form).getByLabelText('From'), { target: { value: '2026-10-20' } });
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: '2026-10-10' } });
    await user.click(within(form).getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('alert')).toHaveTextContent('The start date must be on or before the end date');
    expect(operationsApi.dashboard).toHaveBeenCalledTimes(1);

    fireEvent.change(within(form).getByLabelText('From'), { target: { value: '2020-01-01' } });
    await user.click(within(form).getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at most five years (1,827 days).');

    fireEvent.change(within(form).getByLabelText('From'), { target: { value: '2026-10-01' } });
    await user.click(within(form).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(operationsApi.dashboard).toHaveBeenLastCalledWith('h1', { preset: 'CUSTOM', from: '2026-10-01', to: '2026-10-10', interval: null }));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/dashboard?range=CUSTOM&from=2026-10-01&to=2026-10-10');
  });

  it('shows the server\'s answer to a range it refuses (400 INVALID_RANGE)', async () => {
    vi.mocked(operationsApi.dashboard).mockRejectedValue(
      new ApiError(400, 'INVALID_RANGE', 'Choose a period of at most five years.', [], 'corr-range'));
    open('/hotel-manager/hotels/h1/dashboard?range=CUSTOM&from=2026-01-01&to=2026-12-31');

    expect(await screen.findByText('Choose a period of at most five years.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-range')).toBeInTheDocument();
    // The range can still be changed.
    expect(screen.getByRole('combobox', { name: 'Date range' })).toBeInTheDocument();
  });

  it('lets the server choose when it refuses the interval (400 INVALID_INTERVAL)', async () => {
    vi.mocked(operationsApi.dashboard).mockRejectedValueOnce(
      new ApiError(400, 'INVALID_INTERVAL', 'A daily series has at most 366 points; this range has 400. Choose a longer interval.'));
    const { user, router } = open('/hotel-manager/hotels/h1/dashboard?range=CUSTOM&from=2025-10-01&to=2026-11-04&interval=WEEK');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This interval does not fit the range');
    await user.click(within(alert).getByRole('button', { name: 'Choose the interval automatically' }));
    await waitFor(() => expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/dashboard?range=CUSTOM&from=2025-10-01&to=2026-11-04'));
  });

  it('tells a manager when the hotel is not assigned to them (403 HOTEL_NOT_ASSIGNED)', async () => {
    vi.mocked(operationsApi.dashboard).mockRejectedValue(
      new ApiError(403, 'HOTEL_NOT_ASSIGNED', 'You do not manage this hotel.', [], 'corr-403'));
    const { user, router } = open();

    expect(await screen.findByRole('heading', { name: 'This hotel is not assigned to you' })).toBeInTheDocument();
    expect(screen.getByText('You can only manage the hotels an administrator has assigned to your account.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'My hotels' }));
    expect(currentLocation(router)).toBe('/hotel-manager');
  });

  it('offers a retry when the server fails', async () => {
    vi.mocked(operationsApi.dashboard)
      .mockRejectedValueOnce(new ApiError(503, 'HTTP_503', 'Something went wrong on our side.', [], 'corr-503'))
      .mockResolvedValue(dashboardFixture({ upcomingArrivals: [reservationRow({ leadGuest: 'Ravi Kumar' })] }));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: 'Ravi Kumar' })).toBeInTheDocument();
  });
});
