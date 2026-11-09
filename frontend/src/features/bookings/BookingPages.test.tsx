import { screen, waitFor, within } from '@testing-library/react';

import { accountApi } from '@/features/account/accountApi';
import { documentApi } from '@/features/documents/documentApi';
import { summaryApi, type CustomerSummary } from '@/features/customer/summaryApi';
import { hotelApi } from '@/features/hotels/hotelApi';
import { paymentApi } from '@/features/payments/paymentApi';
import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { bookingApi } from './bookingApi';
import { BookingDetailsPage } from './BookingDetailsPage';
import { BookingReviewPage } from './BookingReviewPage';
import { GuestDetailsPage } from './GuestDetailsPage';
import { MyTripsPage } from './MyTripsPage';
import { loadDraft, saveDraft } from './bookingDraft';
import { bookingFixture, quoteFixture, summaryFixture } from './testData';

vi.mock('@/features/hotels/hotelApi', () => ({ hotelApi: { getQuote: vi.fn() } }));
vi.mock('@/features/account/accountApi', () => ({ accountApi: { getProfile: vi.fn() } }));
vi.mock('@/features/customer/summaryApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/customer/summaryApi')>()),
  summaryApi: { summary: vi.fn() },
}));
vi.mock('@/features/payments/paymentApi', () => ({ paymentApi: { forBooking: vi.fn(), invoiceForBooking: vi.fn() } }));
vi.mock('@/features/documents/documentApi', () => ({ documentApi: { list: vi.fn(), download: vi.fn() } }));
vi.mock('./bookingApi', () => ({
  bookingApi: { createHotelBooking: vi.fn(), list: vi.fn(), details: vi.fn(), timeline: vi.fn(), checkCoupon: vi.fn() },
}));

const auth = () => fakeAuth({ user: customer });
const sinkRoutes = [
  { path: '/my-trips/:id/pay', element: <p>payment page</p> },
  { path: '/book/hotel/:quoteId/review', element: <p>review page</p> },
];

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(documentApi.list).mockResolvedValue([]);
  vi.mocked(summaryApi.summary).mockResolvedValue({
    trips: { upcoming: 3, completed: 5, cancelled: 2, pending: 1 },
  } as CustomerSummary);
  vi.mocked(hotelApi.getQuote).mockResolvedValue(quoteFixture());
  vi.mocked(accountApi.getProfile).mockResolvedValue({ phone: '+91 97000 00000' } as Awaited<ReturnType<typeof accountApi.getProfile>>);
});

describe('GuestDetailsPage', () => {
  const open = () => renderRoutes([{ path: '/book/hotel/:quoteId', element: <GuestDetailsPage /> }, ...sinkRoutes],
    { path: '/book/hotel/quote-1', auth: auth() });

  it('starts with the logged-in customer as lead guest and shows the price held', async () => {
    open();

    expect(await screen.findByRole('heading', { name: 'Guest details' })).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('Asha');
    expect(screen.getByLabelText('Last name')).toHaveValue('Rao');
    expect(screen.getByLabelText('Email')).toHaveValue('asha@example.com');
    await waitFor(() => expect(screen.getByLabelText('Phone')).toHaveValue('+91 97000 00000'));
    expect(screen.getByText('₹2,625.00')).toBeInTheDocument();
    expect(screen.getByText(/Price held for/)).toBeInTheDocument();
  });

  it('asks for one guest per room', async () => {
    vi.mocked(hotelApi.getQuote).mockResolvedValue(quoteFixture({ rooms: 2 }));
    open();

    expect(await screen.findByRole('heading', { name: 'Room 1 guest' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Room 2 guest' })).toBeInTheDocument();
  });

  it('shows what is wrong and does not continue with incomplete details', async () => {
    const { user, router } = open();
    const phone = await screen.findByLabelText('Phone');
    await waitFor(() => expect(phone).toHaveValue('+91 97000 00000'));
    await user.clear(phone);
    await user.clear(screen.getByLabelText('First name'));
    await user.click(screen.getByRole('button', { name: 'Review booking' }));

    expect(await screen.findByText('Enter your first name')).toBeInTheDocument();
    expect(screen.getByText('Enter a phone number for the hotel')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/book/hotel/quote-1');
    expect(loadDraft('quote-1')).toBeNull();
  });

  it('keeps the details for the review step', async () => {
    const { user, router } = open();
    const phone = await screen.findByLabelText('Phone');
    await waitFor(() => expect(phone).toHaveValue('+91 97000 00000'));
    await user.clear(phone);
    await user.type(phone, '+91 98000 00000');
    await user.type(screen.getByLabelText(/Special requests/), 'Late arrival');
    await user.type(screen.getByLabelText(/Coupon code/), 'welcome10');
    await user.click(screen.getByRole('button', { name: 'Review booking' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/book/hotel/quote-1/review'));
    expect(loadDraft('quote-1')).toEqual({
      quoteId: 'quote-1',
      contact: { email: 'asha@example.com', phone: '+91 98000 00000' },
      guests: [{ firstName: 'Asha', lastName: 'Rao' }],
      specialRequests: 'Late arrival',
      couponCode: 'WELCOME10',
    });
  });

  it('previews a coupon and shows why a wrong one is refused', async () => {
    vi.mocked(bookingApi.checkCoupon)
      .mockResolvedValueOnce({ code: 'WELCOME10', title: 'Welcome offer', description: '10% off', discount: 262.5, totalAfterDiscount: 2362.5, currency: 'INR' })
      .mockRejectedValueOnce(new ApiError(422, 'COUPON_INVALID', 'This coupon is not valid.'));
    const { user } = open();
    const code = await screen.findByLabelText(/Coupon code/);

    await user.type(code, 'WELCOME10');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/Welcome offer: you save ₹262.50/)).toBeInTheDocument();
    expect(bookingApi.checkCoupon).toHaveBeenCalledWith({ code: 'WELCOME10', bookingType: 'HOTEL', amount: 2625, destinationCity: undefined });

    await user.clear(code);
    await user.type(code, 'NOPE');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('This coupon is not valid.')).toBeInTheDocument();
  });

  it('tells the customer when the price has expired', async () => {
    vi.mocked(hotelApi.getQuote).mockRejectedValue(new ApiError(404, 'QUOTE_NOT_FOUND', 'Not found'));
    open();

    expect(await screen.findByText('This price has expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search hotels' })).toHaveAttribute('href', '/hotels');
  });
});

describe('BookingReviewPage', () => {
  const draft = {
    quoteId: 'quote-1',
    contact: { email: 'asha@example.com', phone: '+91 98000 00000' },
    guests: [{ firstName: 'Asha', lastName: 'Rao' }],
    specialRequests: 'Late arrival',
    couponCode: 'WELCOME10',
  };
  const open = () => renderRoutes([
    { path: '/book/hotel/:quoteId/review', element: <BookingReviewPage /> },
    { path: '/book/hotel/:quoteId', element: <p>guest details page</p> },
    ...sinkRoutes,
  ], { path: '/book/hotel/quote-1/review', auth: auth() });

  it('sends the customer back to the guest details when there is nothing to review', async () => {
    const { router } = open();

    await waitFor(() => expect(currentLocation(router)).toBe('/book/hotel/quote-1'));
  });

  it('shows the stay, guests, coupon, cancellation policy and the price from the quote', async () => {
    saveDraft(draft);
    open();

    expect(await screen.findByRole('heading', { name: 'Review your booking' })).toBeInTheDocument();
    expect(screen.getByText('Sea Breeze Resort')).toBeInTheDocument();
    expect(screen.getByText(/Guest: Asha Rao/)).toBeInTheDocument();
    expect(screen.getByText('WELCOME10')).toBeInTheDocument();
    expect(screen.getByText('Free cancellation until 2 days before check-in.')).toBeInTheDocument();
    expect(screen.getByText('GST 5%')).toBeInTheDocument();
    expect(screen.getByText('Nothing is charged yet.', { exact: false })).toBeInTheDocument();
  });

  it('needs the terms accepted before booking', async () => {
    saveDraft(draft);
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Confirm and continue to payment' }));

    expect(screen.getByText('Please accept to continue')).toBeInTheDocument();
    expect(bookingApi.createHotelBooking).not.toHaveBeenCalled();
  });

  it('books the quote with only the customer-entered data, then goes to payment', async () => {
    saveDraft(draft);
    vi.mocked(bookingApi.createHotelBooking).mockResolvedValue(bookingFixture({ id: 'b9', status: 'INITIATED' }));
    const { user, router } = open();

    await user.click(await screen.findByRole('checkbox', { name: /I accept the cancellation policy/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm and continue to payment' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/my-trips/b9/pay'));
    const [body, key] = vi.mocked(bookingApi.createHotelBooking).mock.calls[0] ?? [];
    expect(body).toEqual({
      quoteId: 'quote-1',
      contact: draft.contact,
      guests: [{ roomNo: 1, firstName: 'Asha', lastName: 'Rao' }],
      specialRequests: 'Late arrival',
      couponCode: 'WELCOME10',
    });
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    // The booking exists now: the draft (and its key) is gone.
    expect(loadDraft('quote-1')).toBeNull();
  });

  it('does not bounce back to the guest details while the (lazy) payment page loads', async () => {
    // Found in the browser: the payment route is code-split, so there is a moment between "booking made" (draft
    // deleted) and "payment page shown". The review page must not read the missing draft as "start over" then.
    saveDraft(draft);
    vi.mocked(bookingApi.createHotelBooking).mockResolvedValue(bookingFixture({ id: 'b9', status: 'INITIATED' }));
    const { user, router } = renderRoutes([
      { path: '/book/hotel/:quoteId/review', element: <BookingReviewPage /> },
      { path: '/book/hotel/:quoteId', element: <p>guest details page</p> },
      {
        path: '/my-trips/:id/pay',
        lazy: async () => {
          await new Promise((resolve) => setTimeout(resolve, 150));
          return { Component: () => <p>payment page</p> };
        },
      },
    ], { path: '/book/hotel/quote-1/review', auth: auth() });

    await user.click(await screen.findByRole('checkbox', { name: /I accept the cancellation policy/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm and continue to payment' }));

    expect(await screen.findByText('payment page')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/my-trips/b9/pay');
  });

  it('reuses the same key when the customer retries after an error, so no second booking is made', async () => {
    saveDraft(draft);
    vi.mocked(bookingApi.createHotelBooking)
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.'))
      .mockResolvedValueOnce(bookingFixture({ id: 'b9', status: 'INITIATED' }));
    const { user } = open();

    await user.click(await screen.findByRole('checkbox', { name: /I accept the cancellation policy/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm and continue to payment' }));
    expect(await screen.findByText('Cannot reach the server. Check your connection and try again.')).toBeInTheDocument();
    expect(loadDraft('quote-1')?.idempotencyKey).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Confirm and continue to payment' }));

    await waitFor(() => expect(bookingApi.createHotelBooking).toHaveBeenCalledTimes(2));
    const keys = vi.mocked(bookingApi.createHotelBooking).mock.calls.map((call) => call[1]);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe('MyTripsPage', () => {
  const page = (content: ReturnType<typeof summaryFixture>[]) => ({ content, page: 0, size: 10, totalElements: content.length, totalPages: 1 });
  const open = (path = '/my-trips') => renderRoutes([{ path: '/my-trips', element: <MyTripsPage /> }], { path, auth: auth() });

  it('lists the bookings with their status and a Pay now button for one that waits for payment', async () => {
    vi.mocked(bookingApi.list).mockResolvedValue(page([
      summaryFixture({ id: 'b1', status: 'CONFIRMED' }),
      summaryFixture({ id: 'b2', status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', title: 'Palm Grove Hotel', reference: 'HT-AAAA1111' }),
    ]));
    open();

    const list = await screen.findByRole('list', { name: 'Bookings' });
    expect(within(list).getByText('Confirmed')).toBeInTheDocument();
    expect(within(list).getByText('Waiting for payment')).toBeInTheDocument();
    expect(within(list).getAllByText('Demo listing').length).toBeGreaterThan(0);
    expect(within(list).getByRole('link', { name: 'Pay now' })).toHaveAttribute('href', '/my-trips/b2/pay');
    expect(within(list).getByRole('link', { name: 'Palm Grove Hotel' })).toHaveAttribute('href', '/my-trips/b2');
    expect(bookingApi.list).toHaveBeenCalledWith('ALL', 0, 10);
  });

  it('shows how many trips are upcoming, completed, cancelled and pending, and on each tab', async () => {
    vi.mocked(bookingApi.list).mockResolvedValue(page([summaryFixture()]));
    open();

    const overview = await screen.findByRole('list', { name: 'Trip overview' });
    await waitFor(() => expect(within(overview).getByText('Upcoming').closest('li')).toHaveTextContent('3'));
    expect(within(overview).getByText('Completed').closest('li')).toHaveTextContent('5');
    expect(within(overview).getByText('Cancelled').closest('li')).toHaveTextContent('2');
    expect(within(overview).getByText('Pending').closest('li')).toHaveTextContent('1');
    expect(within(overview).getByRole('link', { name: /Upcoming/ })).toHaveAttribute('href', '/my-trips?tab=UPCOMING');
    expect(screen.getByRole('tab', { name: /Completed\s*5/ })).toBeInTheDocument();
  });

  it('searches by words and by kind of trip, keeps both in the URL and can clear them', async () => {
    vi.mocked(bookingApi.list).mockResolvedValue(page([summaryFixture()]));
    const { user, router } = open();
    await screen.findByRole('list', { name: 'Bookings' });

    await user.type(screen.getByRole('searchbox', { name: 'Search my trips' }), 'goa');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(bookingApi.list).toHaveBeenLastCalledWith('ALL', 0, 10, { q: 'goa', type: '' }));
    expect(currentLocation(router)).toBe('/my-trips?q=goa');

    await user.click(screen.getByRole('button', { name: 'Hotels' }));
    await waitFor(() => expect(bookingApi.list).toHaveBeenLastCalledWith('ALL', 0, 10, { q: 'goa', type: 'HOTEL' }));
    expect(currentLocation(router)).toBe('/my-trips?q=goa&type=HOTEL');
    expect(screen.getByRole('button', { name: 'Hotels' })).toHaveAttribute('aria-pressed', 'true');

    vi.mocked(bookingApi.list).mockResolvedValue(page([]));
    await user.click(screen.getByRole('button', { name: 'Flights' }));
    expect(await screen.findByText('No trips match your search')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the search' }));
    await waitFor(() => expect(currentLocation(router)).toBe('/my-trips'));
  });

  it('shows the hotel facts, and links to the payments, support and the details of a trip', async () => {
    vi.mocked(bookingApi.list).mockResolvedValue(page([summaryFixture({
      id: 'b9', reference: 'HT-ZZZZ9999',
      stay: { hotelSlug: null, hotelName: 'Sea Breeze Resort', city: 'Goa', roomTypeName: 'Deluxe Sea View', rooms: 1, adults: 2, children: 1, nights: 2 },
    })]));
    open();

    const list = await screen.findByRole('list', { name: 'Bookings' });
    expect(within(list).getByText('2 adults, 1 child · 1 room')).toBeInTheDocument();
    expect(within(list).getByText(/· 2 nights/)).toBeInTheDocument();
    expect(within(list).getByText('Deluxe Sea View')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'Payment details of HT-ZZZZ9999' })).toHaveAttribute('href', '/account/payments?q=HT-ZZZZ9999');
    expect(within(list).getByRole('link', { name: 'Contact support about HT-ZZZZ9999' })).toHaveAttribute('href', '/account/support/new?bookingId=b9');
  });

  it('puts the chosen tab in the URL and asks for it', async () => {
    vi.mocked(bookingApi.list).mockResolvedValue(page([]));
    const { user, router } = open();
    await screen.findByText('No trips yet');

    await user.click(screen.getByRole('tab', { name: /^Upcoming/ }));

    await waitFor(() => expect(bookingApi.list).toHaveBeenLastCalledWith('UPCOMING', 0, 10));
    expect(currentLocation(router)).toBe('/my-trips?tab=UPCOMING');
    expect(await screen.findByText('Nothing here')).toBeInTheDocument();
  });

  it('asks for another page size from the first page, offering only what the API allows (50)', async () => {
    vi.mocked(bookingApi.list).mockImplementation(async (_tab, pageNo, size = 10) => ({
      content: [summaryFixture({ id: `b-${pageNo}-${size}` })], page: pageNo, size, totalElements: 60, totalPages: Math.ceil(60 / size),
    }));
    const { user, router } = open('/my-trips?tab=UPCOMING&page=2');

    expect(await screen.findByText('Page 3 of 6')).toBeInTheDocument();
    const sizes = screen.getByRole('combobox', { name: 'Per page' });
    expect(sizes).toHaveValue('10');
    expect(within(sizes).getAllByRole('option').map((option) => option.textContent)).toEqual(['10', '25', '50']);

    await user.selectOptions(sizes, '50');

    await waitFor(() => expect(bookingApi.list).toHaveBeenLastCalledWith('UPCOMING', 0, 50));
    expect(currentLocation(router)).toBe('/my-trips?tab=UPCOMING&size=50');
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Per page' })).toHaveValue('50');
  });

  it('offers a retry when loading fails', async () => {
    vi.mocked(bookingApi.list).mockRejectedValue(new ApiError(500, 'HTTP_500', 'Something went wrong on our side. Please try again later.'));
    open();

    expect(await screen.findByText('Something went wrong on our side. Please try again later.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('exports the trips on screen as CSV with what each card shows', async () => {
    const files = stubFileSaving();
    const slice = (origin: string, destination: string, day: string) => ({
      origin, destination, originCity: origin, destinationCity: destination, departureLocal: `${day}T06:00:00`,
      arrivalLocal: `${day}T08:10:00`, durationMinutes: 130, stops: 0, segments: [],
    });
    vi.mocked(bookingApi.list).mockResolvedValue(page([
      summaryFixture({
        id: 'b9', reference: 'HT-ZZZZ9999', createdAt: '2099-03-01T10:00:00',
        stay: { hotelSlug: null, hotelName: 'Sea Breeze Resort', city: 'Goa', roomTypeName: 'Deluxe Sea View', rooms: 1, adults: 2, children: 1, nights: 2 },
      }),
      summaryFixture({
        id: 'b8', reference: 'FL-AAAA1111', type: 'FLIGHT', title: 'Mumbai to Delhi', destination: 'Delhi', status: 'CANCELLED',
        paymentStatus: 'REFUNDED', startDate: '2099-04-01', endDate: '2099-04-05', totalAmount: 9800.5, createdAt: '2099-03-02T09:30:00',
        flight: { tripType: 'ROUND_TRIP', cabin: 'PREMIUM_ECONOMY', adults: 2, children: 0, infants: 0, passengerNames: ['Asha Rao', 'Ravi Rao'],
          slices: [slice('BOM', 'DEL', '2099-04-01'), slice('DEL', 'BOM', '2099-04-05')] },
      }),
    ]));
    const { user } = open();
    await screen.findByRole('list', { name: 'Bookings' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export my trips' });
    // Everything is on this page: no choice of rows.
    expect(within(panel).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(panel).getByText(/The file holds personal data/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]!.fileName).toMatch(/^my-trips-\d{4}-\d{2}-\d{2}\.csv$/);
    expect((await files.blobs[0]!.text()).split('\r\n')).toEqual([
      '"Reference","Type","Trip","Destination","Route or room","From","To","Nights","Travellers","Status","Payment","Amount","Currency","Booked at"',
      '"HT-ZZZZ9999","Hotel","Sea Breeze Resort","Goa","1 × Deluxe Sea View",2099-03-10,2099-03-12,2,"2 adults, 1 child","Confirmed","Paid",2625.00,"INR",2099-03-01 10:00',
      '"FL-AAAA1111","Flight","Mumbai to Delhi","Delhi","BOM → DEL, DEL → BOM · Premium economy",2099-04-01,2099-04-05,,"Asha Rao, Ravi Rao","Cancelled","Refunded",9800.50,"INR",2099-03-02 09:30',
      '',
    ]);
  });

  it('exports all matching trips through the same call, with the tab, the search and the kind of trip', async () => {
    const files = stubFileSaving();
    const all = Array.from({ length: 30 }, (_, index) => summaryFixture({ id: `b${index}`, reference: `HT-${String(index).padStart(8, '0')}` }));
    vi.mocked(bookingApi.list).mockImplementation(async (_tab, pageNo, size = 10) => ({
      content: all.slice(pageNo * size, pageNo * size + size), page: pageNo, size, totalElements: all.length, totalPages: Math.ceil(all.length / size),
    }));
    const { user } = open('/my-trips?tab=UPCOMING&q=goa&type=HOTEL');
    await screen.findByText('Page 1 of 3');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export my trips' });
    expect(within(panel).getByText('Page 1 of 3 · 10 rows')).toBeInTheDocument();
    await user.click(within(panel).getByRole('radio', { name: /All matching rows/ }));
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(bookingApi.list).toHaveBeenLastCalledWith('UPCOMING', 0, 100, { q: 'goa', type: 'HOTEL' });
    const lines = (await files.blobs[0]!.text()).split('\r\n');
    expect(lines).toHaveLength(32);
    expect(lines[30]).toMatch(/^"HT-00000029",/);
  });
});

describe('BookingDetailsPage', () => {
  const open = () => renderRoutes([{ path: '/my-trips/:bookingId', element: <BookingDetailsPage /> }],
    { path: '/my-trips/b1', auth: auth() });

  beforeEach(() => {
    vi.mocked(bookingApi.timeline).mockResolvedValue([
      { fromStatus: null, status: 'INITIATED', reason: 'Booking submitted', at: '2099-03-01T10:00:00Z' },
      { fromStatus: 'INITIATED', status: 'PENDING_PAYMENT', reason: 'Rooms held at the quoted price', at: '2099-03-01T10:00:05Z' },
    ]);
    vi.mocked(paymentApi.forBooking).mockResolvedValue([]);
    vi.mocked(paymentApi.invoiceForBooking).mockRejectedValue(new ApiError(404, 'INVOICE_NOT_FOUND', 'Not found'));
  });

  it('shows a held room with its countdown, a Pay button and NO confirmation number yet', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture());
    open();

    expect(await screen.findByRole('heading', { name: 'Sea Breeze Resort' })).toBeInTheDocument();
    expect(screen.getAllByText('Waiting for payment').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Pay ₹2,625.00' })).toHaveAttribute('href', '/my-trips/b1/pay');
    expect(screen.queryByText('Hotel confirmation no.')).not.toBeInTheDocument();
    expect(screen.getByText('Room charges · 2 nights × 1 room')).toBeInTheDocument();
    expect(screen.getByText('Guest: Asha Rao')).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Booking timeline' })).toBeInTheDocument();
  });

  it('shows the hotel confirmation number, the payment and the invoice once confirmed', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({
      status: 'CONFIRMED', paymentStatus: 'PAID', canPay: false,
      hotel: { ...bookingFixture().hotel!, confirmationNumber: 'SB123456' },
    }));
    vi.mocked(paymentApi.forBooking).mockResolvedValue([{
      id: 'p1', bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', description: 'Sea Breeze Resort', provider: 'DEMO', amount: 2625,
      refundedAmount: 0, currency: 'INR', status: 'SUCCESS', method: 'demo', failureMessage: null,
      createdAt: '2099-03-01T10:01:00Z', verifiedAt: '2099-03-01T10:01:02Z', invoiceNumber: 'INV/2099-00/000001',
    }]);
    vi.mocked(paymentApi.invoiceForBooking).mockResolvedValue({
      id: 'i1', invoiceNumber: 'INV/2099-00/000001', bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', paymentId: 'p1',
      billingName: 'Asha Rao', billingEmail: 'asha@example.com', description: 'Hotel stay', currency: 'INR',
      taxableAmount: 2500, taxAmount: 125, discountAmount: 0, totalAmount: 2625, issuedAt: '2099-03-01T10:02:00Z',
    });
    open();

    expect(await screen.findByText('SB123456')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Pay / })).not.toBeInTheDocument();
    expect(await screen.findByText('INV/2099-00/000001')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Paid in full')).toBeInTheDocument();
  });

  it('explains a booking that could not be made', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({
      status: 'FAILED', canPay: false, failureReason: 'SOLD_OUT',
      failureMessage: 'The room is no longer available.', priceItems: [], totalAmount: 0,
    }));
    open();

    expect((await screen.findAllByText('Not booked')).length).toBeGreaterThan(0);
    expect(screen.getByText('The room is no longer available.')).toBeInTheDocument();
    expect(screen.getByText('The price is shown once the room is held.')).toBeInTheDocument();
  });

  it('says so when the booking does not exist (or belongs to someone else)', async () => {
    vi.mocked(bookingApi.details).mockRejectedValue(new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found.'));
    open();

    expect(await screen.findByText('Booking not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Trips' })).toHaveAttribute('href', '/my-trips');
  });
});
