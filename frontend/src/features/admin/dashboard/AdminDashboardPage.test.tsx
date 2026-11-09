import { screen, waitFor, within } from '@testing-library/react';

import type { Change } from '@/components/analytics/growth';
import { ApiError } from '@/lib/api/apiError';
import { applyInvalidation } from '@/lib/realtime/invalidationRules';
import { currentLocation } from '@/test/renderRoutes';
import { hotelApi } from '@/features/hotels/hotelApi';
import { adminPaymentApi } from '../payments/adminPaymentApi';
import { adminWithout, pageOf, renderAdmin } from '../testUtils';
import { userApi } from '../users/userApi';
import { AdminDashboardPage } from './AdminDashboardPage';
import { dashboardApi, type AdminDashboard, type DashboardPoint } from './dashboardApi';

vi.mock('./dashboardApi', () => ({ dashboardApi: { get: vi.fn() } }));
vi.mock('../payments/adminPaymentApi', () => ({ adminPaymentApi: { list: vi.fn() } }));
vi.mock('../users/userApi', () => ({ userApi: { list: vi.fn() } }));
vi.mock('@/features/hotels/hotelApi', () => ({ hotelApi: { destinations: vi.fn(), details: vi.fn() } }));

beforeEach(() => {
  vi.mocked(hotelApi.destinations).mockImplementation(async (query) => (query === 'Goa' ? [{ city: 'Goa', countryCode: 'IN', hotels: 4 }] : []));
  vi.mocked(hotelApi.details).mockResolvedValue({
    id: 'h1', guestRating: 4.6, reviewCount: 120, images: [{ id: 'i1', url: '/img/sea.jpg', thumbUrl: '/img/sea-t.jpg', caption: null, roomTypeId: null, width: 10, height: 10 }],
  } as Awaited<ReturnType<typeof hotelApi.details>>);
  vi.mocked(adminPaymentApi.list).mockResolvedValue(pageOf([
    { id: 'p1aaaaaa-0000-0000-0000-000000000000', bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', description: null, provider: 'DEMO',
      amount: 6300, refundedAmount: 0, currency: 'INR', status: 'SUCCESS', method: 'demo', failureMessage: null, createdAt: '2026-11-05T10:00:00Z',
      verifiedAt: null, invoiceNumber: null, userId: 'u1', contactEmail: 'asha@example.com', providerPaymentId: null, providerOrderId: null,
      failureCode: null },
  ]));
  vi.mocked(userApi.list).mockResolvedValue(pageOf([
    { id: 'u1', email: 'asha@example.com', firstName: 'Asha', lastName: 'Rao', status: 'ACTIVE', roles: ['CUSTOMER'], emailVerified: true,
      lastLoginAt: null, createdAt: '2026-11-05T09:00:00Z' },
  ]));
});

const change = (current: number, previous: number, changePercent: number | null): Change => ({
  current, previous, change: current - previous, changePercent, trend: current > previous ? 'UP' : current < previous ? 'DOWN' : 'FLAT',
});

const point = (key: string, overrides: Partial<DashboardPoint> = {}): DashboardPoint => ({
  key, start: key, end: key, bookings: 0, hotelBookings: 0, flightBookings: 0, cancellations: 0, gross: 0, refunds: 0, net: 0,
  hotelGross: 0, flightGross: 0, hotelNet: 0, flightNet: 0, successfulPayments: 0, failedPayments: 0, failedAmount: 0, newCustomers: 0,
  ...overrides,
});

const dashboard = (overrides: Partial<AdminDashboard> = {}): AdminDashboard => ({
  range: { preset: 'LAST_30_DAYS', from: '2026-10-07', to: '2026-11-05' },
  previousRange: { preset: 'PREVIOUS_PERIOD', from: '2026-09-07', to: '2026-10-06' },
  interval: 'DAY',
  customers: { total: 120, newInRange: 14, active: 48 },
  bookings: { flight: 40, hotel: 55, upcoming: 30, completed: 12, cancelled: 9, pending: 3, failed: 6 },
  payments: { pendingCount: 3, pendingAmount: 18900, successfulCount: 80, successfulAmount: 512340, failedCount: 4, failedAmount: 25000, successRate: 95.2 },
  revenue: { gross: 512340, refunds: 40200, net: 472140, currency: 'INR' },
  products: {
    hotel: { bookings: 55, cancelled: 6, cancellationRate: 10.9, gross: 350000, refunds: 30000, net: 320000 },
    flight: { bookings: 40, cancelled: 3, cancellationRate: 7.5, gross: 162340, refunds: 10200, net: 152140 },
    all: { bookings: 95, cancelled: 9, cancellationRate: 9.5, gross: 512340, refunds: 40200, net: 472140 },
  },
  cancellations: {
    count: 9, hotel: 6, flight: 3, byInitiator: { CUSTOMER: 7, SUPPORT_AGENT: 1, ADMIN: 0, HOTEL: 1 },
    cancellationFees: 4100, refundAmount: 38000, rate: 9.5, hotelRate: 10.9, flightRate: 7.5,
  },
  comparison: {
    bookings: change(95, 76, 25),
    hotelBookings: change(55, 0, null),
    flightBookings: change(40, 50, -20),
    grossRevenue: change(512340, 409872, 25),
    refunds: change(40200, 20100, 100),
    netRevenue: change(472140, 389772, 21.1),
    hotelRevenue: change(320000, 256000, 25),
    flightRevenue: change(152140, 133772, 13.7),
    successfulPayments: change(80, 60, 33.3),
    failedPayments: change(4, 2, 100),
    cancellations: change(9, 12, -25),
    cancellationRate: { current: 9.5, previous: 8, change: 1.5, changePercent: 18.8, trend: 'UP' },
    newCustomers: change(14, 0, null),
  },
  series: [
    point('2026-11-04', { hotelBookings: 3, flightBookings: 1, bookings: 4, hotelGross: 12000, gross: 12000, net: 12000, hotelNet: 12000, successfulPayments: 4, newCustomers: 2 }),
    point('2026-11-05', { hotelBookings: 1, flightBookings: 2, bookings: 3, hotelGross: 3300, flightGross: 3000, gross: 6300, refunds: 3150, net: 3150, hotelNet: 150, flightNet: 3000, successfulPayments: 3, failedPayments: 1, cancellations: 1, newCustomers: 1 }),
  ],
  popularDestinations: [{ city: 'Goa', bookings: 21, revenue: 140000, previousBookings: 10 }, { city: 'Jaipur', bookings: 5, revenue: 20000, previousBookings: 0 }],
  topHotels: [{ hotelId: 'h1', hotelName: 'Sea Breeze Resort', city: 'Goa', bookings: 9, revenue: 70000, previousBookings: 12 }],
  recentBookings: [{ id: 'b1', reference: 'HT-7K3M9Q2X', type: 'HOTEL', status: 'CONFIRMED', title: 'Sea Breeze Resort', totalAmount: 6300,
    createdAt: '2026-11-05T09:00:00Z', customerName: 'Asha Rao', customerEmail: 'asha@example.com', destination: 'Goa' }],
  recentActivity: [{ occurredAt: '2026-11-05T09:30:00Z', action: 'BOOKING_CANCELLED', entityType: 'BOOKING', entityId: 'b9', service: 'booking-service', actorRole: 'CUSTOMER' }],
  timeline: [
    { at: '2026-11-05T09:30:00Z', type: 'BOOKING_CANCELLED', outcome: 'CANCELLED', title: 'Booking cancelled', detail: 'HT-AAAA1111 · by customer', amount: 2500, entityType: 'BOOKING', entityId: 'b9' },
    { at: '2026-11-05T09:20:00Z', type: 'PAYMENT_FAILED', outcome: 'FAILED', title: 'Payment failed', detail: 'HT-BBBB2222 · upi', amount: 1800, entityType: 'PAYMENT', entityId: 'p9' },
    { at: '2026-11-05T09:10:00Z', type: 'BOOKING_CREATED', outcome: 'PENDING', title: 'Flight booking', detail: 'FL-CCCC3333 · Delhi to Goa', amount: 9690, entityType: 'BOOKING', entityId: 'b8' },
    { at: '2026-11-05T09:00:00Z', type: 'PAYMENT_SUCCEEDED', outcome: 'SUCCESS', title: 'Payment received', detail: 'HT-7K3M9Q2X · card', amount: 6300, entityType: 'PAYMENT', entityId: 'p8' },
    { at: '2026-11-05T08:50:00Z', type: 'CUSTOMER_REGISTERED', outcome: 'SUCCESS', title: 'New customer registered', detail: 'Ravi Kumar', amount: null, entityType: 'USER', entityId: 'u8' },
    { at: '2026-11-05T08:40:00Z', type: 'SUPPORT_TICKET', outcome: 'INFO', title: 'Ticket assigned', detail: null, amount: null, entityType: 'TICKET', entityId: 't8' },
  ],
  generatedAt: '2026-11-05T10:00:00Z',
  ...overrides,
});

const routes = [
  { path: '/admin', element: <AdminDashboardPage /> },
  { path: '/admin/bookings/:bookingId', element: <p>booking page</p> },
  { path: '/admin/payments/:paymentId', element: <p>payment page</p> },
];

/** A headline figure (label, value, chip) of the revenue band. */
const figure = (region: HTMLElement, label: string) => within(region).getByText(label, { exact: true }).parentElement as HTMLElement;

/** The KPI card in `region` whose label is `label` (cards are list items). */
const card = (region: HTMLElement, label: string) =>
  within(region).getAllByRole('listitem').find((item) => within(item).queryByText(label, { exact: true })) as HTMLElement;

describe('AdminDashboardPage', () => {
  // The charts are lazy-loaded; load recharts once up front, so no single test pays for it.
  beforeAll(async () => {
    await import('@/components/charts/impl/rechartsPlots');
  }, 60_000);

  it('shows every figure of the range with its change against the previous period', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    renderAdmin(routes, '/admin');

    await screen.findByRole('list', { name: 'Popular destinations' });
    const revenue = screen.getByRole('region', { name: 'Revenue' });
    expect(figure(revenue, 'Net revenue')).toHaveTextContent('₹4,72,140');
    expect(figure(revenue, 'Net revenue')).toHaveTextContent('Up 21.1%');
    expect(figure(revenue, 'Gross revenue')).toHaveTextContent('₹5,12,340');
    expect(figure(revenue, 'Refunds')).toHaveTextContent('₹40,200');
    const headline = screen.getByRole('list', { name: 'Headline figures' });
    expect(card(headline, 'Paid bookings')).toHaveTextContent('95');
    expect(card(headline, 'Paid bookings')).not.toHaveTextContent(/NaN|Infinity|∞/);

    const payments = screen.getByRole('region', { name: 'Payments' });
    expect(card(payments, 'Collected revenue')).toHaveTextContent('₹5,12,340');
    expect(card(payments, 'Successful payments')).toHaveTextContent('80');
    expect(card(payments, 'Successful payments')).toHaveTextContent('₹5,12,340 captured');
    expect(card(payments, 'Failed payments')).toHaveTextContent('₹25,000 not collected');
    // More failed payments is bad news: the chip is red.
    expect(within(card(payments, 'Failed payments')).getByText('Up', { exact: false }).parentElement).toHaveClass('bg-danger-50');
    expect(card(payments, 'Payment success rate')).toHaveTextContent('95.2%');
    // 80 of 82 attempts before = 96.8 %, now 95.2 %: a change in percentage points.
    expect(card(payments, 'Payment success rate')).toHaveTextContent('Down 1.6 percentage points');
    // Money still due is shown as due, never as collected.
    expect(card(payments, 'Pending payments')).toHaveTextContent('₹18,900 due, not collected yet');
    expect(card(payments, 'Refunded')).toHaveTextContent('₹40,200');

    const cancellations = screen.getByRole('region', { name: 'Cancellations' });
    expect(card(cancellations, 'Cancellations')).toHaveTextContent('Confirmed in the range');
    expect(within(card(cancellations, 'Cancellations')).getByText('Down', { exact: false }).parentElement).toHaveClass('bg-success-50');
    expect(card(cancellations, 'Cancellation rate')).toHaveTextContent('9.5%');
    expect(card(cancellations, 'Cancellation rate')).toHaveTextContent('9 of 95 paid bookings created in the range');
    expect(card(cancellations, 'Cancellation rate')).toHaveTextContent('Up 1.5 percentage points');
    expect(card(cancellations, 'Hotel cancellations')).toHaveTextContent('6');
    expect(card(cancellations, 'Hotel cancellations')).toHaveTextContent('Rate 10.9% of hotel bookings');
    expect(card(cancellations, 'Flight cancellations')).toHaveTextContent('Rate 7.5% of flight bookings');
    expect(card(cancellations, 'Cancellation fees kept')).toHaveTextContent('₹4,100');
    expect(card(cancellations, 'Refunded for cancellations')).toHaveTextContent('₹38,000');
    expect(within(cancellations).getByText(/The rate is cancelled ÷ paid bookings created in the same range/)).toBeInTheDocument();

    const customers = screen.getByRole('region', { name: 'Customers' });
    expect(card(customers, 'Registered customers')).toHaveTextContent('120');
    expect(card(customers, 'New customers')).toHaveTextContent('14');
    expect(card(customers, 'Active customers')).toHaveTextContent('48');
    expect(card(customers, 'Active customers')).toHaveTextContent('40% of registered booked in the range');

    expect(screen.getByText(/Figures for 7 Oct – 5 Nov 2026 \(India time\), compared with 7 Sep – 6 Oct 2026/)).toBeInTheDocument();
    expect(dashboardApi.get).toHaveBeenCalledWith({ preset: 'LAST_30_DAYS', from: '', to: '', interval: null });
  });

  it('shows the booking status as counts and shares of all bookings, in statuses the booking model has', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    renderAdmin(routes, '/admin');

    await screen.findByRole('list', { name: 'Popular destinations' });
    const status = screen.getByRole('region', { name: 'Booking status' });
    const list = within(status).getByRole('list', { name: 'Booking status figures' });
    // 30 + 12 + 3 + 9 + 6 = 60 bookings.
    for (const [label, count, percent] of [['Confirmed', '30', '50%'], ['Completed', '12', '20%'], ['Pending', '3', '5%'], ['Cancelled', '9', '15%'], ['Failed or expired', '6', '10%']]) {
      const row = within(list).getByText(label!).closest('li')!;
      expect(row).toHaveTextContent(count!);
      expect(row).toHaveTextContent(percent!);
    }
    expect(within(status).getByRole('img', { name: /^Bookings by status, 60 in total\. Confirmed: 30 \(50%\)/ })).toBeInTheDocument();
  });

  it('compares hotels with flights: bookings, revenue and each type\'s share, net or gross', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    const { user } = renderAdmin(routes, '/admin');

    await screen.findByRole('list', { name: 'Popular destinations' });
    const type = screen.getByRole('region', { name: 'Bookings and revenue by booking type' });
    const hotels = within(type).getByRole('article', { name: 'Hotels' });
    const flights = within(type).getByRole('article', { name: 'Flights' });
    expect(hotels).toHaveTextContent('55');
    expect(hotels).toHaveTextContent('₹3,20,000');
    expect(hotels).toHaveTextContent('57.9%');   // 55 of 95 bookings
    expect(hotels).toHaveTextContent('67.8%');   // 3,20,000 of 4,72,140
    expect(hotels).toHaveTextContent('Gross ₹3,50,000 · refunds ₹30,000');
    expect(flights).toHaveTextContent('40');
    expect(flights).toHaveTextContent('₹1,52,140');
    expect(flights).toHaveTextContent('42.1%');
    expect(flights).toHaveTextContent('32.2%');

    await user.click(within(type).getByRole('radio', { name: 'Gross revenue' }));
    expect(hotels).toHaveTextContent('₹3,50,000');
    expect(hotels).toHaveTextContent('68.3%');   // 3,50,000 of 5,12,340
    expect(within(type).getByRole('img', { name: /^Gross revenue per day by booking type, 4 Nov to 5 Nov\. Hotels: ₹15,300 in total.*Flights: ₹3,000 in total/ })).toBeInTheDocument();
  });

  it('draws the trends at the server\'s interval with summaries and tables', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    const { user } = renderAdmin(routes, '/admin');

    expect(await screen.findByRole('img', { name: /^Bookings per day by booking type, 4 Nov to 5 Nov\. Hotels: 4 in total.*Flights: 3 in total/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Net revenue per day by booking type.*Hotels: ₹12,150 in total.*Flights: ₹3,000 in total/ })).toBeInTheDocument();
    const bookingRows = within(screen.getByRole('table', { name: 'Bookings per day by booking type' })).getAllByRole('row');
    expect(bookingRows.map((row) => row.textContent)).toEqual(['DateHotelsFlights', '4 Nov31', '5 Nov12']);
    expect(screen.getByRole('img', { name: /^Cancellations per day.*Cancellations: 1 in total/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Cancellations by booking type, 9 in total\. Hotels: 6 \(66\.7%\)\. Flights: 3 \(33\.3%\)\./ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Cancellations by who cancelled, 9 in total\. Customer: 7 .*Support agent: 1 .*Admin: 0 .*Hotel: 1 / })).toBeInTheDocument();

    // Payments: the amounts by default, the attempts on request.
    expect(screen.getByRole('img', { name: /^Collected and net revenue per day.*Collected: ₹18,300 in total/ })).toBeInTheDocument();
    await user.click(within(screen.getByRole('region', { name: 'Payments' })).getByRole('radio', { name: 'Attempts' }));
    expect(screen.getByRole('img', { name: /^Payment attempts per day.*Successful: 7 in total.*Failed: 1 in total/ })).toBeInTheDocument();

    // Customers: growth (registered at the end of each day, ending at the 120 above), or the new ones.
    const customers = screen.getByRole('region', { name: 'Customers' });
    expect(within(customers).getByRole('img', { name: /^Registered customers over time.*Registered customers: \d+ at the start, 120 at the end/ })).toBeInTheDocument();
    await user.click(within(customers).getByRole('radio', { name: 'New' }));
    expect(screen.getByRole('img', { name: /^New customers per day.*New customers: 3 in total/ })).toBeInTheDocument();
  });

  it('names the charts after the interval and reads month points as months', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard({
      range: { preset: 'THIS_YEAR', from: '2026-01-01', to: '2026-11-05' },
      interval: 'MONTH',
      series: [point('2026-10', { start: '2026-10-01', hotelBookings: 2 }), point('2026-11', { start: '2026-11-01', hotelBookings: 5, flightBookings: 1 })],
    }));
    renderAdmin(routes, '/admin?range=THIS_YEAR');

    expect(await screen.findByRole('img', { name: /^Bookings per month by booking type, Oct 2026 to Nov 2026\. Hotels: 7 in total/ })).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Bookings per month by booking type' })).getAllByRole('row')[1]).toHaveTextContent('Oct 2026');
    expect(screen.getByRole('radio', { name: 'Month' })).toBeChecked();
    expect(screen.getByText('chosen automatically')).toBeInTheDocument();
  });

  it('shows popular destinations with their country and trend, and top hotels with photo, rating and trend', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    renderAdmin(routes, '/admin');

    const destinations = await screen.findByRole('list', { name: 'Popular destinations' });
    const [goa, jaipur] = within(destinations).getAllByRole('listitem');
    expect(goa).toHaveTextContent('Goa');
    expect(goa).toHaveTextContent('21');
    expect(goa).toHaveTextContent('₹1,40,000');
    expect(await within(goa!).findByText('India')).toBeInTheDocument();       // from the hotel catalogue
    expect(goa).toHaveTextContent('Up 110%');                                  // 10 -> 21 bookings
    expect(jaipur).toHaveTextContent('New');                                   // nothing in the previous period
    expect(within(jaipur!).queryByText('India')).not.toBeInTheDocument();      // no hotels there: no invented country

    const hotels = screen.getByRole('list', { name: 'Top hotels' });
    const hotel = within(hotels).getByRole('listitem');
    expect(within(hotel).getByRole('link', { name: 'Sea Breeze Resort' })).toHaveAttribute('href', '/admin/hotels?q=Sea%20Breeze%20Resort');
    expect(await within(hotel).findByRole('img', { name: 'Sea Breeze Resort' })).toHaveAttribute('src', '/img/sea-t.jpg');
    expect(hotel).toHaveTextContent('4.6');
    expect(hotel).toHaveTextContent('(120)');
    expect(hotel).toHaveTextContent('₹70,000');
    expect(hotel).toHaveTextContent('9 bookings');
    expect(hotel).toHaveTextContent('Down 25%');                               // 12 -> 9
    expect(hotelApi.details).toHaveBeenCalledWith('h1');
  });

  it('does not invent a rating or a photo for a hotel that has none', async () => {
    vi.mocked(hotelApi.details).mockResolvedValue({ id: 'h1', guestRating: null, reviewCount: 0, images: [] } as unknown as Awaited<ReturnType<typeof hotelApi.details>>);
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    renderAdmin(routes, '/admin');

    const hotel = within(await screen.findByRole('list', { name: 'Top hotels' })).getByRole('listitem');
    await waitFor(() => expect(hotelApi.details).toHaveBeenCalled());
    expect(hotel).not.toHaveTextContent('4.6');
    expect(within(hotel).queryByRole('img', { name: 'Sea Breeze Resort' })).not.toBeInTheDocument();
  });

  it('lists recent bookings with customer, destination, amount and status (linked), and the activity timeline', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    const { user, router } = renderAdmin(routes, '/admin');

    const table = await screen.findByRole('table', { name: 'Recent bookings' });
    const row = within(table).getByRole('link', { name: 'HT-7K3M9Q2X' }).closest('tr')!;
    expect(row).toHaveTextContent('Asha Rao');
    expect(row).toHaveTextContent('asha@example.com');
    expect(row).toHaveTextContent('Goa');
    expect(row).toHaveTextContent('₹6,300');
    expect(row).toHaveTextContent('Confirmed');
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/admin/bookings');

    const activity = screen.getByRole('list', { name: 'Recent activity' });
    const items = within(activity).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[0]).toHaveTextContent('Booking cancelled');
    expect(items[0]).toHaveTextContent('Cancelled');
    expect(items[1]).toHaveTextContent('Payment failed');
    expect(items[1]).toHaveTextContent('Failed');
    expect(items[2]).toHaveTextContent('Flight booking');
    expect(items[2]).toHaveTextContent('Pending');
    expect(items[3]).toHaveTextContent('Payment received');
    expect(items[3]).toHaveTextContent('Successful');
    expect(items[3]).toHaveTextContent('₹6,300');
    expect(items[4]).toHaveTextContent('New customer registered');
    expect(items[5]).toHaveTextContent('Ticket assigned');
    expect(within(items[1]!).getByRole('link')).toHaveAttribute('href', '/admin/payments/p9');
    expect(within(items[5]!).getByRole('link')).toHaveAttribute('href', '/support/tickets/t8');
    expect(screen.getByRole('link', { name: 'Audit logs' })).toHaveAttribute('href', '/admin/audit-logs');

    await user.click(within(table).getByRole('link', { name: 'HT-7K3M9Q2X' }));
    expect(currentLocation(router)).toBe('/admin/bookings/b1');
  });

  it('shows empty states for a range without bookings, destinations or activity', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard({
      bookings: { flight: 0, hotel: 0, upcoming: 0, completed: 0, cancelled: 0, pending: 0, failed: 0 },
      popularDestinations: [], topHotels: [], recentBookings: [], timeline: [], series: [],
    }));
    renderAdmin(routes, '/admin');

    expect(await screen.findByText('No bookings in this range')).toBeInTheDocument();
    expect(screen.getByText('Nothing happened in this range')).toBeInTheDocument();
    expect(screen.getAllByText('Nothing in this range')).toHaveLength(2);
    expect(screen.getByText('No bookings were created in this range.')).toBeInTheDocument();
  });

  it('lists the newest payments and registrations from their own APIs, only for admins who may read them', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    const { user, router } = renderAdmin(routes, '/admin');

    const payments = await screen.findByRole('list', { name: 'Recent payments' });
    expect(payments).toHaveTextContent('HT-7K3M9Q2X');
    expect(payments).toHaveTextContent('Paid');
    expect(adminPaymentApi.list).toHaveBeenCalledWith(expect.objectContaining({ sort: 'createdAt,desc', page: 0 }), 5);
    const customers = await screen.findByRole('list', { name: 'New registrations' });
    expect(customers).toHaveTextContent('Asha Rao');
    expect(userApi.list).toHaveBeenCalledWith(expect.objectContaining({ role: 'CUSTOMER', sort: 'createdAt,desc' }), 5);

    await user.click(within(payments).getByRole('link', { name: /HT-7K3M9Q2X/ }));
    expect(currentLocation(router)).toBe('/admin/payments/p1aaaaaa-0000-0000-0000-000000000000');
  });

  it('leaves out the recent lists the admin may not read', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    renderAdmin(routes, '/admin', adminWithout('PAYMENT_READ_ANY', 'USER_READ_ANY'));

    await screen.findByRole('list', { name: 'Popular destinations' });
    expect(screen.queryByRole('list', { name: 'Recent payments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'New registrations' })).not.toBeInTheDocument();
    expect(adminPaymentApi.list).not.toHaveBeenCalled();
    expect(userApi.list).not.toHaveBeenCalled();
  });

  it('keeps the chosen range and interval in the URL and asks for them', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    const { user, router } = renderAdmin(routes, '/admin?range=CUSTOM&from=2026-10-01&to=2026-10-10');

    await screen.findByRole('region', { name: 'Payments' });
    expect(dashboardApi.get).toHaveBeenLastCalledWith({ preset: 'CUSTOM', from: '2026-10-01', to: '2026-10-10', interval: null });
    expect(screen.getByLabelText('From')).toHaveValue('Thu, 1 Oct 2026');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Date range' }), 'Last 7 days');
    await waitFor(() => expect(dashboardApi.get).toHaveBeenLastCalledWith({ preset: 'LAST_7_DAYS', from: '', to: '', interval: null }));
    expect(currentLocation(router)).toBe('/admin?range=LAST_7_DAYS');

    await user.click(screen.getByRole('radio', { name: 'Week' }));
    await waitFor(() => expect(dashboardApi.get).toHaveBeenLastCalledWith({ preset: 'LAST_7_DAYS', from: '', to: '', interval: 'WEEK' }));
    expect(currentLocation(router)).toBe('/admin?range=LAST_7_DAYS&interval=WEEK');

    await user.click(screen.getByRole('button', { name: 'Choose automatically' }));
    await waitFor(() => expect(currentLocation(router)).toBe('/admin?range=LAST_7_DAYS'));
  });

  it('disables and explains the intervals the server would refuse for a long range', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard({ range: { preset: 'LAST_5_YEARS', from: '2022-01-01', to: '2026-11-05' }, interval: 'YEAR' }));
    renderAdmin(routes, '/admin?range=LAST_5_YEARS&interval=DAY');

    await screen.findByRole('list', { name: 'Popular destinations' });
    // A refused interval in the URL is not sent: the server chooses.
    expect(dashboardApi.get).toHaveBeenLastCalledWith({ preset: 'LAST_5_YEARS', from: '', to: '', interval: null });
    const day = screen.getByRole('radio', { name: 'Day' });
    expect(day).toBeDisabled();
    expect(day).toHaveAccessibleDescription(/Day: this range has 1,770 days, at most 366 can be shown\. Choose a longer interval\./);
    expect(screen.getByRole('radio', { name: 'Week' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Year' })).toBeChecked();
    expect(screen.getByText('Day not available: too many points for this range.')).toBeInTheDocument();
  });

  it('explains an interval the server refused and lets it choose', async () => {
    vi.mocked(dashboardApi.get).mockRejectedValueOnce(
      new ApiError(400, 'INVALID_INTERVAL', 'A daily series has at most 366 points; this range has 400. Choose a longer interval.', [], 'corr-7'));
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    const { user, router } = renderAdmin(routes, '/admin?range=CUSTOM&from=2025-10-01&to=2026-11-04&interval=WEEK');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This interval does not fit the range');
    expect(alert).toHaveTextContent('A daily series has at most 366 points');
    await user.click(within(alert).getByRole('button', { name: 'Choose the interval automatically' }));
    await waitFor(() => expect(currentLocation(router)).toBe('/admin?range=CUSTOM&from=2025-10-01&to=2026-11-04'));
    expect(await screen.findByRole('region', { name: 'Payments' })).toBeInTheDocument();
  });

  it('refreshes when the server says the figures changed (dashboard.updated)', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard());
    const { queryClient } = renderAdmin(routes, '/admin');
    await screen.findByRole('list', { name: 'Popular destinations' });
    vi.mocked(dashboardApi.get).mockResolvedValue(dashboard({ revenue: { gross: 600000, refunds: 0, net: 600000, currency: 'INR' } }));

    applyInvalidation(queryClient, { id: '1', type: 'dashboard.updated', resourceType: 'DASHBOARD', resourceId: null, data: {}, occurredAt: '2026-11-05T10:00:10Z' });

    await waitFor(() => expect(figure(screen.getByRole('region', { name: 'Revenue' }), 'Net revenue')).toHaveTextContent('₹6,00,000'));
    expect(dashboardApi.get).toHaveBeenCalledTimes(2);
  });

  it('shows the reason and the support reference when loading fails', async () => {
    vi.mocked(dashboardApi.get).mockRejectedValue(new ApiError(400, 'INVALID_RANGE', 'Choose at most five years.', [], 'corr-1'));
    renderAdmin(routes, '/admin');

    expect(await screen.findByText('Choose at most five years.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('is closed without the REPORT_VIEW permission', () => {
    renderAdmin(routes, '/admin', adminWithout('REPORT_VIEW'));

    expect(screen.getByRole('heading', { name: "You don't have access to this section" })).toBeInTheDocument();
    expect(dashboardApi.get).not.toHaveBeenCalled();
  });
});
