import { screen, waitFor, within } from '@testing-library/react';

import { bookingApi } from '@/features/bookings/bookingApi';
import { summaryFixture as tripFixture } from '@/features/bookings/testData';
import { homeApi } from '@/features/home/homeApi';
import { notificationApi } from '@/features/notifications/notificationApi';
import { paymentApi } from '@/features/payments/paymentApi';
import { ApiError } from '@/lib/api/apiError';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { CustomerDashboardPage } from './CustomerDashboardPage';
import { summaryApi, type CustomerSummary, type NextTrip } from './summaryApi';

vi.mock('./summaryApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./summaryApi')>()),
  summaryApi: { summary: vi.fn() },
}));
vi.mock('@/features/bookings/bookingApi', () => ({ bookingApi: { list: vi.fn() } }));
vi.mock('@/features/notifications/notificationApi', () => ({ notificationApi: { unreadCount: vi.fn(), list: vi.fn() } }));
vi.mock('@/features/payments/paymentApi', () => ({ paymentApi: { history: vi.fn(), historySummary: vi.fn() } }));
vi.mock('@/features/home/homeApi', () => ({ homeApi: { recommendedHotels: vi.fn() } }));

const month = (key: string, values: Partial<CustomerSummary['monthlyActivity'][number]> = {}) => ({
  month: key, start: `${key}-01`, end: `${key}-28`, bookings: 0, hotelBookings: 0, flightBookings: 0, paid: 0, refunded: 0, net: 0, ...values,
});

const flightTrip: NextTrip = {
  bookingId: 'b-flight', reference: 'FL-C6CNEWE9', type: 'FLIGHT', status: 'CONFIRMED', title: 'Delhi to Goa', destination: 'Goa',
  startDate: '2026-11-15', endDate: '2026-11-15', startsAt: '2026-11-14T23:40:00Z', daysUntil: 9, inProgress: false,
  totalAmount: 9690, currency: 'INR', hotel: null,
  flight: {
    tripType: 'ONE_WAY', cabin: 'ECONOMY', origin: 'DEL', destination: 'GOI', originCity: 'Delhi', destinationCity: 'Goa',
    departureLocal: '2026-11-15T05:10', arrivalLocal: '2026-11-15T07:59', airlineName: 'Air India', flightNumber: 'AI 390',
    stops: 0, passengers: 1, pnr: 'LXWDK8', returnDepartureLocal: null,
  },
};

const hotelTrip: NextTrip = {
  ...flightTrip, bookingId: 'b-hotel', reference: 'HT-AR8QC9RD', type: 'HOTEL', title: 'Sea Breeze Resort', startDate: '2026-11-07',
  endDate: '2026-11-10', daysUntil: 1, flight: null,
  hotel: {
    hotelName: 'Sea Breeze Resort', city: 'Goa', address: 'Calangute Beach Road', checkIn: '2026-11-07', checkOut: '2026-11-10',
    checkInTime: '14:00', checkOutTime: '11:00', nights: 3, rooms: 1, guests: 2, roomTypeName: 'Deluxe Sea View', confirmationNumber: 'HXK2M4P7Q',
  },
};

function summary(overrides: Partial<CustomerSummary> = {}): CustomerSummary {
  return {
    range: { preset: 'LAST_12_MONTHS', from: '2025-12-01', to: '2026-11-06' },
    bookings: { total: 3, hotel: 2, flight: 1, upcoming: 2, completed: 0, cancelled: 1 },
    trips: { upcoming: 2, completed: 4, cancelled: 1, pending: 0 },
    spending: {
      currency: 'INR', paid: 50227, refunded: 18172, net: 32055, refundsInProgress: 0,
      hotel: { paid: 40537, refunded: 18172, net: 22365 }, flight: { paid: 9690, refunded: 0, net: 9690 },
    },
    monthlyActivity: [month('2025-12'), month('2026-11', { bookings: 3, hotelBookings: 2, flightBookings: 1, paid: 50227, refunded: 18172, net: 32055 })],
    nextTrip: flightTrip,
    generatedAt: '2026-11-06T09:00:00Z',
    ...overrides,
  };
}

/** The previous period: two bookings (both hotel), nothing paid. */
const previous = summary({
  range: { preset: 'CUSTOM', from: '2024-12-25', to: '2025-11-30' },
  bookings: { total: 2, hotel: 2, flight: 0, upcoming: 0, completed: 2, cancelled: 0 },
  spending: { currency: 'INR', paid: 0, refunded: 0, net: 0, refundsInProgress: 0, hotel: { paid: 0, refunded: 0, net: 0 }, flight: { paid: 0, refunded: 0, net: 0 } },
  monthlyActivity: [],
  nextTrip: null,
});

const empty = summary({
  bookings: { total: 0, hotel: 0, flight: 0, upcoming: 0, completed: 0, cancelled: 0 },
  trips: { upcoming: 0, completed: 0, cancelled: 0, pending: 0 },
  spending: { currency: 'INR', paid: 0, refunded: 0, net: 0, refundsInProgress: 0, hotel: { paid: 0, refunded: 0, net: 0 }, flight: { paid: 0, refunded: 0, net: 0 } },
  monthlyActivity: [month('2025-12'), month('2026-11')],
  nextTrip: null,
});

/** Answers like the server: the asked range echoed, `CUSTOM` ranges are the previous period. */
function serve(current: CustomerSummary, before: CustomerSummary = previous) {
  vi.mocked(summaryApi.summary).mockImplementation(async (params) => {
    if (params.range === 'CUSTOM' && params.from === before.range.from) return before;
    if (params.range === 'CUSTOM') return { ...current, range: { preset: 'CUSTOM', from: params.from!, to: params.to! } };
    if (params.range === 'ALL_TIME') return { ...current, range: { preset: 'ALL_TIME', from: '2026-11-01', to: '2026-11-06' } };
    if (params.range === 'THIS_YEAR') return { ...current, range: { preset: 'THIS_YEAR', from: '2026-01-01', to: '2026-11-06' } };
    return current;
  });
}

const open = (path = '/customer/dashboard') =>
  renderRoutes([{ path: '/customer/dashboard', element: <CustomerDashboardPage /> }], { path, auth: fakeAuth({ user: customer }) });

/** The KPI card with this label inside the named list. */
const figure = (list: string, label: string) =>
  within(screen.getByRole('list', { name: list })).getByText(label, { exact: true }).closest('li')!;

beforeEach(() => {
  // Reduced motion: the KPI numbers show their final value at once.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  vi.mocked(bookingApi.list).mockResolvedValue({ content: [], totalElements: 0, totalPages: 0, page: 0, size: 5 });
  vi.mocked(notificationApi.unreadCount).mockResolvedValue(0);
  vi.mocked(notificationApi.list).mockResolvedValue({ content: [], totalElements: 0, totalPages: 0, page: 0, size: 5 });
  vi.mocked(paymentApi.history).mockResolvedValue({ content: [], totalElements: 0, totalPages: 0, page: 0, size: 5 });
  vi.mocked(paymentApi.historySummary).mockResolvedValue({ total: 0, successful: 0, failed: 0, pending: 0, paidAmount: 0, refundedAmount: 0, currency: 'INR' });
  vi.mocked(homeApi.recommendedHotels).mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CustomerDashboardPage', () => {
  it('greets the customer and shows the next trip with its countdown and a link to the booking', async () => {
    serve(summary());
    open();

    expect(screen.getByRole('heading', { level: 1, name: 'Welcome, Asha' })).toBeInTheDocument();
    const trip = await screen.findByRole('region', { name: 'Your next trip' });
    expect(within(trip).getByText('Delhi to Goa')).toBeInTheDocument();
    expect(within(trip).getByText('Air India · AI 390 · Economy · Non-stop')).toBeInTheDocument();
    expect(within(trip).getByText('Departs in 9 days')).toBeInTheDocument();
    expect(within(trip).getByText('LXWDK8')).toBeInTheDocument();
    expect(within(trip).getByText('Sun, 15 Nov 2026, 05:10 · DEL')).toBeInTheDocument();
    expect(within(trip).getByRole('link', { name: 'View booking FL-C6CNEWE9' })).toHaveAttribute('href', '/my-trips/b-flight');
  });

  it('shows a hotel stay with its check-in details', async () => {
    serve(summary({ nextTrip: hotelTrip }));
    open();

    const trip = await screen.findByRole('region', { name: 'Your next trip' });
    expect(within(trip).getByText('Sea Breeze Resort')).toBeInTheDocument();
    expect(within(trip).getByText('Check-in tomorrow')).toBeInTheDocument();
    expect(within(trip).getByText('7 Nov 2026, from 14:00')).toBeInTheDocument();
    expect(within(trip).getByText('3 nights · 1 room · 2 guests')).toBeInTheDocument();
    expect(within(trip).getByText('HXK2M4P7Q')).toBeInTheDocument();
  });

  it('says so when no trip is coming up, with the searches', async () => {
    serve(summary({ nextTrip: null }));
    open();

    const trip = await screen.findByRole('region', { name: 'No trips coming up' });
    expect(within(trip).getByRole('link', { name: 'Search flights' })).toHaveAttribute('href', '/flights');
    expect(within(trip).getByRole('link', { name: 'Search hotels' })).toHaveAttribute('href', '/hotels');
  });

  it('shows the figures of the API and compares them with the period of the same length before', async () => {
    serve(summary());
    open();

    await screen.findByRole('list', { name: 'Bookings figures' });
    // The second call asks for the 341 days before 1 Dec 2025.
    await waitFor(() => expect(summaryApi.summary).toHaveBeenCalledWith({ range: 'CUSTOM', from: '2024-12-25', to: '2025-11-30' }));
    expect(summaryApi.summary).toHaveBeenCalledWith({ range: 'LAST_12_MONTHS' });

    const bookings = figure('Bookings figures', 'Bookings');
    expect(within(bookings).getAllByText('3')[0]).toBeInTheDocument();
    expect(await within(bookings).findByText(/50%/)).toHaveTextContent('Up 50%');
    expect(within(bookings).getByText('2 upcoming · 0 completed · 1 cancelled')).toBeInTheDocument();
    // 1 flight now, none before: "New", never ∞ or NaN.
    const flights = figure('Bookings figures', 'Flights');
    expect(within(flights).getByText(/^New/)).toHaveTextContent('New: nothing in the previous period');
    // 2 hotel stays now and before.
    expect(within(figure('Bookings figures', 'Hotel stays')).getByText(/0%/)).toHaveTextContent('No change, 0%');

    expect(within(figure('Spending figures', 'Paid')).getAllByText('₹50,227')[0]).toBeInTheDocument();
    expect(within(figure('Spending figures', 'Refunded')).getAllByText('₹18,172')[0]).toBeInTheDocument();
    expect(within(figure('Spending figures', 'Net spending')).getAllByText('₹32,055')[0]).toBeInTheDocument();
    expect(screen.queryByText('Refunds in progress')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/∞|NaN|Infinity/);

    expect(screen.getByText('1 Dec 2025 – 6 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText(/changes compared with 25 Dec 2024 – 30 Nov 2025/)).toBeInTheDocument();
  });

  it('shows the trips as they are now, each linked to its My Trips tab, and the pending ones', async () => {
    serve(summary({ trips: { upcoming: 2, completed: 4, cancelled: 1, pending: 1 } }));
    open();

    expect(await screen.findByText(/1 booking is waiting for payment or confirmation/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Trip figures' });
    expect(within(list).getByRole('link', { name: /Upcoming trips/ })).toHaveAttribute('href', '/my-trips?tab=UPCOMING');
    expect(within(list).getByRole('link', { name: /Completed trips/ })).toHaveAttribute('href', '/my-trips?tab=COMPLETED');
    expect(within(list).getByRole('link', { name: /Cancelled trips/ })).toHaveAttribute('href', '/my-trips?tab=CANCELLED');
    expect(within(figure('Trip figures', 'Completed trips')).getAllByText('4')[0]).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See pending bookings' })).toHaveAttribute('href', '/my-trips?tab=PENDING');
  });

  it('shows refunds in progress only when there are some', async () => {
    const withRefund = summary();
    withRefund.spending = { ...withRefund.spending, refundsInProgress: 4500 };
    serve(withRefund);
    open();

    expect(await within(await screen.findByRole('list', { name: 'Spending figures' })).findByText('Refunds in progress')).toBeInTheDocument();
    expect(within(figure('Spending figures', 'Refunds in progress')).getAllByText('₹4,500')[0]).toBeInTheDocument();
  });

  it('keeps the period in the URL and asks the API for it', async () => {
    serve(summary());
    const { user, router } = open();

    await screen.findByRole('list', { name: 'Bookings figures' });
    await user.click(screen.getByRole('radio', { name: 'This year' }));

    expect(currentLocation(router)).toBe('/customer/dashboard?range=THIS_YEAR');
    await waitFor(() => expect(summaryApi.summary).toHaveBeenCalledWith({ range: 'THIS_YEAR' }));
    // 1 Jan … 6 Nov 2026 is 310 days: compared with 25 Feb … 31 Dec 2025.
    await waitFor(() => expect(summaryApi.summary).toHaveBeenCalledWith({ range: 'CUSTOM', from: '2025-02-25', to: '2025-12-31' }));
    expect(await screen.findByText('1 Jan – 6 Nov 2026')).toBeInTheDocument();
  });

  it('reads the period from the URL on load', async () => {
    serve(summary());
    open('/customer/dashboard?range=PREVIOUS_YEAR');

    await waitFor(() => expect(summaryApi.summary).toHaveBeenCalledWith({ range: 'PREVIOUS_YEAR' }));
    expect(screen.getByRole('radio', { name: 'Previous year' })).toBeChecked();
  });

  it('checks custom dates before applying them, then puts them in the URL', async () => {
    serve(summary());
    const { user, router } = open();

    await screen.findByRole('list', { name: 'Bookings figures' });
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    await user.type(screen.getByLabelText('From'), '2025-06-30');
    await user.type(screen.getByLabelText('To'), '2025-06-01');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The end date must be on or after the start date.');
    expect(currentLocation(router)).toBe('/customer/dashboard');

    await user.clear(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), '2025-07-31');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(currentLocation(router)).toBe('/customer/dashboard?range=CUSTOM&from=2025-06-30&to=2025-07-31');
    await waitFor(() => expect(summaryApi.summary).toHaveBeenCalledWith({ range: 'CUSTOM', from: '2025-06-30', to: '2025-07-31' }));
  });

  it('does not compare "All time" (nothing comes before it)', async () => {
    serve(summary());
    open('/customer/dashboard?range=ALL_TIME');

    expect(await screen.findByText(/no earlier period to compare with/)).toBeInTheDocument();
    expect(vi.mocked(summaryApi.summary).mock.calls.map(([params]) => params.range)).toEqual(['ALL_TIME']);
    expect(within(figure('Bookings figures', 'Bookings')).queryByText(/%|New/)).not.toBeInTheDocument();
  });

  it('draws the monthly bookings and spending, with their tables', async () => {
    serve(summary());
    open();

    const bookingsTable = await screen.findByRole('table', { name: 'Bookings per month' });
    const november = within(bookingsTable).getByRole('row', { name: /Nov 2026/ });
    expect(november).toHaveTextContent('Nov 202621');
    const spendingTable = screen.getByRole('table', { name: 'Spending per month' });
    expect(within(spendingTable).getByRole('row', { name: /Nov 2026/ })).toHaveTextContent('₹50,227₹18,172₹32,055');
    const split = screen.getByRole('table', { name: 'Net spending by type' });
    expect(split).toHaveTextContent('Hotel stays₹22,365');
    expect(split).toHaveTextContent('Flights₹9,690');
  });

  it('lists the latest bookings from My Trips with their status and a link', async () => {
    serve(summary());
    vi.mocked(bookingApi.list).mockResolvedValue({
      content: [tripFixture({ id: 'b1', reference: 'HT-ABC123', title: 'Sea Breeze Resort', status: 'CONFIRMED' })],
      totalElements: 1, totalPages: 1, page: 0, size: 5,
    });
    open();

    const list = await screen.findByRole('list', { name: 'Recent bookings' });
    expect(bookingApi.list).toHaveBeenCalledWith('ALL', 0, 5);
    expect(within(list).getByRole('link', { name: 'Sea Breeze Resort' })).toHaveAttribute('href', '/my-trips/b1');
    expect(within(list).getByText('Confirmed')).toBeInTheDocument();
    expect(within(list).getByText(/Reference HT-ABC123/)).toBeInTheDocument();
  });

  it('shows pending payments, recent payments and notifications, and recommended hotels, all from the APIs', async () => {
    serve(summary());
    vi.mocked(paymentApi.historySummary).mockResolvedValue({ total: 4, successful: 2, failed: 1, pending: 1, paidAmount: 5000, refundedAmount: 0, currency: 'INR' });
    vi.mocked(paymentApi.history).mockResolvedValue({
      content: [{ id: 'p1aaaaaa-0000-0000-0000-000000000000', bookingId: 'b1', bookingReference: 'HT-ABC123', description: null, provider: 'DEMO', amount: 2625,
        refundedAmount: 0, currency: 'INR', status: 'SUCCESS', method: 'demo', failureMessage: null, createdAt: '2026-11-05T10:00:00Z',
        verifiedAt: null, invoiceNumber: null, bookingType: 'HOTEL' }],
      totalElements: 1, totalPages: 1, page: 0, size: 5,
    });
    vi.mocked(notificationApi.list).mockResolvedValue({
      content: [{ id: 'n1', category: 'BOOKING', title: 'Booking confirmed', message: 'Your stay is confirmed.', link: '/my-trips/b1', read: false, createdAt: '2026-11-05T09:00:00Z' }],
      totalElements: 1, totalPages: 1, page: 0, size: 5,
    });
    vi.mocked(homeApi.recommendedHotels).mockResolvedValue([
      { id: 'h1', slug: 'palm-grove', name: 'Palm Grove', city: 'Kochi', starRating: 4, guestRating: 4.6, reviewCount: 12, imageUrl: null, priceFrom: 3200, demo: false },
    ]);
    open();

    const payments = await screen.findByRole('list', { name: 'Recent payments' });
    expect(payments).toHaveTextContent('HT-ABC123');
    expect(payments).toHaveTextContent('Paid');
    expect(paymentApi.history).toHaveBeenCalledWith(0, 5);
    const notifications = await screen.findByRole('list', { name: 'Recent notifications' });
    expect(within(notifications).getByRole('link', { name: /Booking confirmed/ })).toHaveAttribute('href', '/my-trips/b1');
    expect(within(notifications).getByText('New')).toBeInTheDocument();
    expect(within(await screen.findByRole('list', { name: 'Recommended hotels' })).getByRole('link', { name: /Palm Grove/ })).toHaveAttribute('href', '/hotels/palm-grove');
    const trips = screen.getByRole('list', { name: 'Trip figures' });
    await waitFor(() => expect(within(trips).getByText('Pending payments').closest('li')).toHaveTextContent('1'));
    expect(screen.getByRole('heading', { name: 'Booking status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hotels and flights' })).toBeInTheDocument();
  });

  it('shows the unread notifications in the quick actions', async () => {
    serve(summary());
    vi.mocked(notificationApi.unreadCount).mockResolvedValue(3);
    open();

    const actions = screen.getByRole('navigation', { name: 'Quick actions' });
    expect(await within(actions).findByText('3 unread')).toBeInTheDocument();
    expect(within(actions).getByRole('link', { name: /Support tickets/ })).toHaveAttribute('href', '/account/support');
  });

  it('invites a customer who never booked instead of showing zeros', async () => {
    serve(empty);
    open();

    expect(await screen.findByRole('heading', { name: 'Your first trip starts here' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Bookings figures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'This year' })).not.toBeInTheDocument();
    const welcome = screen.getByRole('region', { name: 'Your first trip starts here' });
    expect(within(welcome).getByRole('link', { name: 'Search flights' })).toHaveAttribute('href', '/flights');
  });

  it('shows the error with a retry', async () => {
    serve(summary());
    vi.mocked(summaryApi.summary).mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'The booking service is busy.', [], 'corr-1'));
    const { user } = open();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your dashboard could not be loaded');
    expect(alert).toHaveTextContent('Support reference: corr-1');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Your next trip' })).toBeInTheDocument();
  });

  it('offers the default period when the server refuses one', async () => {
    serve(summary());
    vi.mocked(summaryApi.summary).mockRejectedValueOnce(new ApiError(400, 'INVALID_RANGE', 'The range is too long.'));
    const { user, router } = open('/customer/dashboard?range=PREVIOUS_YEAR');

    expect(await screen.findByRole('alert')).toHaveTextContent('This period cannot be shown');
    await user.click(screen.getByRole('button', { name: 'Show the last 12 months' }));
    expect(currentLocation(router)).toBe('/customer/dashboard');
    expect(await screen.findByRole('region', { name: 'Your next trip' })).toBeInTheDocument();
  });
});
