import { act, screen, within } from '@testing-library/react';

import { documentApi } from '@/features/documents/documentApi';
import { paymentApi } from '@/features/payments/paymentApi';
import { PaymentPage } from '@/features/payments/PaymentPage';
import { PaymentResultPage } from '@/features/payments/PaymentResultPage';
import { formatShortDate } from '@/lib/format';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { bookingApi } from './bookingApi';
import { BookingDetailsPage } from './BookingDetailsPage';
import { MyTripsPage } from './MyTripsPage';
import { failureAdvice, statusDescription, statusLabel } from './status';
import { bookingFixture, summaryFixture } from './testData';
import type { BookingDetails, FlightTrip } from './types';

vi.mock('./bookingApi', () => ({ bookingApi: { details: vi.fn(), timeline: vi.fn(), list: vi.fn() } }));
vi.mock('@/features/payments/paymentApi', () => ({ paymentApi: { forBooking: vi.fn(), invoiceForBooking: vi.fn(), createOrder: vi.fn() } }));
vi.mock('@/features/documents/documentApi', () => ({ documentApi: { list: vi.fn(), download: vi.fn() } }));
vi.mock('@/features/settings/usePublicSettings', () => ({ usePublicSettings: () => ({ settings: { siteName: 'FlightHotel' } }) }));

const auth = () => fakeAuth({ user: customer });

const flightTrip = (overrides: Partial<FlightTrip> = {}): FlightTrip => ({
  offerId: 'trip-1', tripType: 'ROUND_TRIP', cabin: 'ECONOMY', fareName: 'Flex', refundable: true, checkedBaggageKg: 20, cabinBaggageKg: 7,
  cancellationFeePercent: 25, cancellationPolicy: 'Refundable: a 25% fee applies up to departure.', adults: 1, children: 1, infants: 0, demo: true, pnr: null,
  slices: [
    { origin: 'DEL', destination: 'BOM', originCity: 'Delhi', destinationCity: 'Mumbai', departureLocal: '2099-03-10T06:45', arrivalLocal: '2099-03-10T08:55', durationMinutes: 130, stops: 0,
      segments: [{ flightNumber: 'AI 504', airlineCode: 'AI', airlineName: 'Air India', origin: 'DEL', destination: 'BOM', departureLocal: '2099-03-10T06:45', arrivalLocal: '2099-03-10T08:55', durationMinutes: 130 }] },
    { origin: 'BOM', destination: 'DEL', originCity: 'Mumbai', destinationCity: 'Delhi', departureLocal: '2099-03-14T22:30', arrivalLocal: '2099-03-15T03:10', durationMinutes: 280, stops: 1,
      segments: [
        { flightNumber: 'AI 661', airlineCode: 'AI', airlineName: 'Air India', origin: 'BOM', destination: 'HYD', departureLocal: '2099-03-14T22:30', arrivalLocal: '2099-03-15T00:45', durationMinutes: 135 },
        { flightNumber: 'AI 661', airlineCode: 'AI', airlineName: 'Air India', origin: 'HYD', destination: 'DEL', departureLocal: '2099-03-15T02:00', arrivalLocal: '2099-03-15T03:10', durationMinutes: 70 },
      ] },
  ],
  passengers: [
    { passengerNo: 1, passengerType: 'ADULT', firstName: 'Asha', lastName: 'Rao', dateOfBirth: '1990-04-02', gender: 'FEMALE', nationality: 'IN', passportLast4: '4567', ticketNumber: null },
    { passengerNo: 2, passengerType: 'CHILD', firstName: 'Mini', lastName: 'Rao', dateOfBirth: '2092-06-01', gender: null, nationality: null, passportLast4: null, ticketNumber: null },
  ],
  ...overrides,
});

const flightBooking = (overrides: Partial<BookingDetails> = {}, trip: Partial<FlightTrip> = {}): BookingDetails => bookingFixture({
  type: 'FLIGHT', title: 'Delhi to Mumbai', destination: 'Mumbai', startDate: '2099-03-10', endDate: '2099-03-14', hotel: null, flight: flightTrip(trip),
  priceItems: [{ type: 'ROOM', label: 'Fare · 1 adult, 1 child', amount: 8000 }, { type: 'TAX', label: 'GST 5%', amount: 400 }], totalAmount: 8400,
  ...overrides,
});

beforeEach(() => {
  vi.mocked(documentApi.list).mockResolvedValue([]);
  vi.mocked(bookingApi.timeline).mockResolvedValue([]);
  vi.mocked(paymentApi.forBooking).mockResolvedValue([]);
  vi.mocked(paymentApi.invoiceForBooking).mockRejectedValue(new Error('none'));
});

describe('status wording for flights', () => {
  it('says airline and seats where hotels say hotel and room', () => {
    expect(statusLabel('SUPPLIER_PENDING', 'FLIGHT')).toBe('Confirming with the airline');
    expect(statusLabel('SUPPLIER_PENDING')).toBe('Confirming with the hotel');
    expect(statusLabel('INITIATED', 'FLIGHT')).toBe('Securing your seats');
    expect(statusLabel('CONFIRMED', 'FLIGHT')).toBe('Confirmed');
    expect(statusDescription('CONFIRMED', 'FLIGHT')).toMatch(/PNR/);
    // Statuses without flight-specific wording read the same as for hotels.
    expect(statusDescription('REFUND_PENDING', 'FLIGHT')).toBe(statusDescription('REFUND_PENDING'));
    expect(statusDescription('PENDING_PAYMENT', 'FLIGHT')).toMatch(/seats/);
    expect(statusDescription('PENDING_PAYMENT')).toMatch(/room/);
  });

  it.each(['OFFER_EXPIRED', 'SOLD_OUT', 'PRICE_CHANGED', 'INVALID_PASSENGERS', 'NO_RESPONSE', 'PAYMENT_TIMEOUT'])('explains the flight failure %s without talking about rooms', (reason) => {
    const advice = failureAdvice(reason, 'FLIGHT');

    expect(advice.length).toBeGreaterThan(20);
    expect(advice).not.toMatch(/room|hotel/i);
  });
});

describe('BookingDetailsPage for a flight', () => {
  const open = () => renderRoutes([{ path: '/my-trips/:bookingId', element: <BookingDetailsPage /> }], { path: '/my-trips/b1', auth: auth() });

  it('shows the itinerary, passengers, baggage and fare, but no PNR or ticket before the airline issued the booking', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(flightBooking());
    open();

    expect(await screen.findByRole('heading', { name: 'Delhi to Mumbai' })).toBeInTheDocument();
    expect(screen.getAllByText('Demo inventory').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Outbound flight' })).toHaveTextContent('Air India · AI 504');
    expect(screen.getByRole('region', { name: 'Return flight' })).toHaveTextContent('Stop at HYD · 1h 15m layover');
    expect(screen.getByText('Check-in 20 kg · Cabin 7 kg per passenger')).toBeInTheDocument();
    expect(screen.getByText(/Round trip · Economy · Flex · Refundable/)).toBeInTheDocument();
    const passengers = screen.getByRole('list', { name: 'Passengers of this booking' });
    expect(within(passengers).getByText(/Asha Rao/)).toHaveTextContent('passport ••••4567');
    expect(screen.queryByText(/Airline booking reference/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ticket /)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pay ₹8,400.00' })).toHaveAttribute('href', '/my-trips/b1/pay');
    expect(screen.getByText(/Pay within \d+:\d\d to keep your seats\./)).toBeInTheDocument();
    expect(screen.getAllByText('Waiting for payment').length).toBeGreaterThan(0);
  });

  it('never shows a PNR while the airline is still confirming, even if one is present in the data', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(flightBooking({ status: 'SUPPLIER_PENDING', paymentStatus: 'PAID', canPay: false }, { pnr: 'ABC123' }));
    open();

    expect(await screen.findAllByText('Confirming with the airline')).not.toHaveLength(0);
    expect(screen.queryByText(/ABC123/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Pay / })).not.toBeInTheDocument();
  });

  it('shows the PNR and every ticket number once confirmed', async () => {
    const trip = flightTrip({ pnr: 'X7K2PQ' });
    trip.passengers[0]!.ticketNumber = '098-1234567890';
    trip.passengers[1]!.ticketNumber = '098-1234567891';
    vi.mocked(bookingApi.details).mockResolvedValue(flightBooking({ status: 'CONFIRMED', paymentStatus: 'PAID', canPay: false, flight: trip }));
    open();

    expect(await screen.findByText('X7K2PQ')).toBeInTheDocument();
    expect(screen.getByText('Ticket 098-1234567890')).toBeInTheDocument();
    expect(screen.getByText('Ticket 098-1234567891')).toBeInTheDocument();
    expect(screen.getByText('Your flight is confirmed. Show your booking reference (PNR) and ticket number at check-in.')).toBeInTheDocument();
    expect(screen.getByText('Paid in full')).toBeInTheDocument();
  });

  it('explains a flight that could not be booked in flight words', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(flightBooking({ status: 'FAILED', canPay: false, failureReason: 'SOLD_OUT', failureMessage: null, priceItems: [], totalAmount: 0, flight: null }));
    open();

    expect(await screen.findByText('We could not complete this booking. Nothing was charged.')).toBeInTheDocument();
    expect(screen.getByText('The price is shown once the seats are held.')).toBeInTheDocument();
  });
});

describe('MyTripsPage with flights', () => {
  it('shows a flight with its icon, route, one-way date and the demo label next to hotels', async () => {
    vi.mocked(bookingApi.list).mockResolvedValue({
      content: [
        summaryFixture({ id: 'f1', type: 'FLIGHT', title: 'Delhi to Mumbai', destination: 'Mumbai', startDate: '2099-03-10', endDate: '2099-03-10', status: 'SUPPLIER_PENDING' }),
        summaryFixture({ id: 'h1', title: 'Sea Breeze Resort' }),
      ],
      page: 0, size: 10, totalElements: 2, totalPages: 1,
    });
    renderRoutes([{ path: '/my-trips', element: <MyTripsPage /> }], { path: '/my-trips', auth: auth() });

    const list = await screen.findByRole('list', { name: 'Bookings' });
    expect(within(list).getAllByRole('img', { name: 'Flight' }).length).toBeGreaterThan(0);
    expect(within(list).getByRole('img', { name: 'Hotel' })).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'Delhi to Mumbai' })).toHaveAttribute('href', '/my-trips/f1');
    expect(within(list).getByText('Confirming with the airline')).toBeInTheDocument();
    expect(within(list).getByText('Demo inventory')).toBeInTheDocument();
    expect(within(list).getByText('Demo listing')).toBeInTheDocument();
    // One-way: a single date, not "date to date".
    expect(within(list).getByText(formatShortDate('2099-03-10'))).toBeInTheDocument();
  });

  it('draws the route of a flight: times, airports, airline, flight number, stops and the travellers', async () => {
    const slice = (origin: string, destination: string, from: string, to: string) => ({
      origin, destination, originCity: origin === 'DEL' ? 'Delhi' : 'Mumbai', destinationCity: destination === 'DEL' ? 'Delhi' : 'Mumbai',
      departureLocal: from, arrivalLocal: to, durationMinutes: 130, stops: 0,
      segments: [{ flightNumber: 'AI 887', airlineCode: 'AI', airlineName: 'Air India', origin, destination, departureLocal: from, arrivalLocal: to, durationMinutes: 130 }],
    });
    vi.mocked(bookingApi.list).mockResolvedValue({
      content: [summaryFixture({
        id: 'f2', type: 'FLIGHT', title: 'Delhi to Mumbai', destination: 'Mumbai', startDate: '2099-03-10', endDate: '2099-03-14',
        flight: {
          tripType: 'ROUND_TRIP', cabin: 'ECONOMY', adults: 2, children: 0, infants: 0, passengerNames: ['Asha Rao', 'Ravi Rao'],
          slices: [slice('DEL', 'BOM', '2099-03-10T06:15', '2099-03-10T08:25'), slice('BOM', 'DEL', '2099-03-14T18:00', '2099-03-14T20:10')],
        },
      })],
      page: 0, size: 10, totalElements: 1, totalPages: 1,
    });
    renderRoutes([{ path: '/my-trips', element: <MyTripsPage /> }], { path: '/my-trips', auth: auth() });

    const list = await screen.findByRole('list', { name: 'Bookings' });
    expect(within(list).getByText('06:15')).toBeInTheDocument();
    expect(within(list).getAllByText(/DEL · /).length).toBeGreaterThan(0);
    expect(within(list).getByText('Outbound')).toBeInTheDocument();
    expect(within(list).getByText('Return')).toBeInTheDocument();
    expect(within(list).getAllByText('Air India AI 887')).toHaveLength(2);
    expect(within(list).getAllByText('Non-stop')).toHaveLength(2);
    expect(within(list).getByText('Asha Rao, Ravi Rao')).toBeInTheDocument();
  });
});

describe('PaymentPage for a flight', () => {
  const open = () => renderRoutes([
    { path: '/my-trips/:bookingId/pay', element: <PaymentPage /> },
    { path: '/my-trips/:bookingId/result', element: <p>result page</p> },
  ], { path: '/my-trips/b1/pay', auth: auth() });

  it('waits while the seats are held', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(flightBooking({ status: 'INITIATED', canPay: false, priceItems: [], totalAmount: 0 }));
    open();

    expect(await screen.findByText('Securing your seats…')).toBeInTheDocument();
    expect(screen.getByText(/checking it with the airline/)).toBeInTheDocument();
  });

  it('shows the route, travellers and the server price next to the payment button', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(flightBooking());
    open();

    expect(await screen.findByText(/Your seats are held for you\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delhi to Mumbai' })).toBeInTheDocument();
    expect(screen.getByText(`DEL to BOM · ${formatShortDate('2099-03-10')} 06:45`)).toBeInTheDocument();
    expect(screen.getByText('1 adult, 1 child')).toBeInTheDocument();
    expect(screen.getByText('Fare · 1 adult, 1 child')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay ₹8,400.00' })).toBeInTheDocument();
  });

  it('says the flight could not be booked and offers a new flight search (nothing was charged)', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(flightBooking({ status: 'FAILED', canPay: false, failureReason: 'PRICE_CHANGED', failureMessage: null }));
    open();

    expect(await screen.findByText('We could not book this flight')).toBeInTheDocument();
    expect(screen.getAllByText(/fare changed since you searched/).length).toBeGreaterThan(0);
    expect(screen.getByText('Nothing was charged.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search flights' })).toHaveAttribute('href', '/flights');
    expect(screen.queryByRole('link', { name: 'Search hotels' })).not.toBeInTheDocument();
  });
});

describe('PaymentResultPage for a flight', () => {
  const open = () => renderRoutes([{ path: '/my-trips/:bookingId/result', element: <PaymentResultPage /> }], { path: '/my-trips/b1/result', auth: auth() });

  it('waits for the airline and does not call the booking confirmed after the payment alone', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(flightBooking({ status: 'SUPPLIER_PENDING', paymentStatus: 'PAID', canPay: false }));
    open();

    expect(await screen.findByText('Payment received. Confirming with the airline…')).toBeInTheDocument();
    expect(screen.getByText(/final confirmation from the airline/)).toBeInTheDocument();
    expect(screen.queryByText('Your booking is confirmed')).not.toBeInTheDocument();
    expect(screen.queryByText(/The airline is taking longer than usual/)).not.toBeInTheDocument();
  });

  it('after a minute says the airline is taking longer, that the payment is safe and nobody must pay again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(bookingApi.details).mockResolvedValue(flightBooking({ status: 'SUPPLIER_PENDING', paymentStatus: 'PAID', canPay: false }));
      open();
      await screen.findByText('Payment received. Confirming with the airline…');

      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });

      expect(screen.getByText('The airline is taking longer than usual')).toBeInTheDocument();
      expect(screen.getByText(/refunded in full\. You do not need to pay again/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the route, PNR and a demo notice once the airline confirmed', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(flightBooking({ status: 'CONFIRMED', paymentStatus: 'PAID', canPay: false }, { pnr: 'X7K2PQ' }));
    open();

    expect(await screen.findByText('Your booking is confirmed')).toBeInTheDocument();
    expect(screen.getByText('X7K2PQ')).toBeInTheDocument();
    expect(screen.getByText('Delhi to Mumbai')).toBeInTheDocument();
    expect(screen.getByText('DEL to BOM')).toBeInTheDocument();
    expect(screen.getByText(/demo flight inventory\. No real ticket is issued\./)).toBeInTheDocument();
    expect(screen.queryByText('Hotel confirmation no.')).not.toBeInTheDocument();
  });

  it('says why a flight booking was not completed', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(flightBooking({ status: 'EXPIRED', canPay: false, failureReason: 'OFFER_EXPIRED', failureMessage: null }));
    open();

    expect(await screen.findByText('This booking was not completed')).toBeInTheDocument();
    expect(screen.getByText(/Fares are kept for 20 minutes/)).toBeInTheDocument();
  });

  it('a paid flight that cannot be issued is refunded in full', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(flightBooking({ status: 'REFUND_PENDING', paymentStatus: 'REFUND_PENDING', canPay: false, failureMessage: null }));
    open();

    expect(await screen.findByText('We could not confirm your booking')).toBeInTheDocument();
    expect(screen.getByText(/being refunded in full/)).toBeInTheDocument();
  });
});
