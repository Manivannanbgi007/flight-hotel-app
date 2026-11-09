import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { accountApi } from '@/features/account/accountApi';
import type { Passenger } from '@/features/account/types';
import { bookingApi } from '@/features/bookings/bookingApi';
import { bookingFixture } from '@/features/bookings/testData';
import { ApiError } from '@/lib/api/apiError';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { flightApi } from './flightApi';
import { FlightDetailsPage } from './FlightDetailsPage';
import { FlightReviewPage } from './FlightReviewPage';
import { clearFlightDraft, loadFlightDraft, recallPassportNumbers, rememberPassportNumbers, saveFlightDraft, type FlightDraft } from './flightDraft';
import { PassengerDetailsPage } from './PassengerDetailsPage';
import { BOM, DEL, tripFixture } from './testData';

vi.mock('./flightApi', () => ({ flightApi: { getTrip: vi.fn() } }));
vi.mock('@/features/account/accountApi', () => ({ accountApi: { getProfile: vi.fn(), listPassengers: vi.fn() } }));
vi.mock('@/features/bookings/bookingApi', () => ({ bookingApi: { createFlightBooking: vi.fn(), checkCoupon: vi.fn() } }));

const auth = () => fakeAuth({ user: customer });
const sink = [
  { path: '/book/flight/:id', element: <p>passenger page</p> },
  { path: '/book/flight/:id/review', element: <p>review page</p> },
  { path: '/my-trips/:id/pay', element: <p>payment page</p> },
];

const twoLegs = () => tripFixture({
  slices: [{
    ...tripFixture().slices[0]!,
    stops: 1, viaAirport: 'HYD', departureLocal: '2099-03-10T22:30', arrivalLocal: '2099-03-11T03:10', durationMinutes: 280,
    segments: [
      { flightNumber: 'AI 660', origin: 'DEL', destination: 'HYD', departureLocal: '2099-03-10T22:30', arrivalLocal: '2099-03-11T00:45', durationMinutes: 135 },
      { flightNumber: 'AI 660', origin: 'HYD', destination: 'BOM', departureLocal: '2099-03-11T02:00', arrivalLocal: '2099-03-11T03:10', durationMinutes: 70 },
    ],
  }],
});

beforeEach(() => {
  sessionStorage.clear();
  clearFlightDraft('trip-1');
  vi.mocked(flightApi.getTrip).mockResolvedValue(tripFixture());
  vi.mocked(accountApi.getProfile).mockResolvedValue({ phone: '+91 97000 00000' } as Awaited<ReturnType<typeof accountApi.getProfile>>);
  vi.mocked(accountApi.listPassengers).mockResolvedValue([]);
});

describe('FlightDetailsPage', () => {
  const open = () => renderRoutes([{ path: '/flights/trip/:tripOfferId', element: <FlightDetailsPage /> }, ...sink], { path: '/flights/trip/trip-1' });

  it('shows the itinerary, baggage, fare rules, the price lines and a countdown', async () => {
    open();

    expect(await screen.findByRole('heading', { name: 'Delhi to Mumbai' })).toBeInTheDocument();
    expect(screen.getByText('Demo inventory')).toBeInTheDocument();
    expect(screen.getByText('06:45')).toBeInTheDocument();
    expect(screen.getByText('Air India · AI 504')).toBeInTheDocument();
    expect(screen.getByText('Check-in 15 kg · Cabin 7 kg per passenger')).toBeInTheDocument();
    expect(screen.getAllByText(/Non-refundable: the full fare is charged if you cancel\./).length).toBeGreaterThan(0);
    expect(screen.getByText(/Date changes and rebooking are not available/)).toBeInTheDocument();
    expect(screen.getByText('Fare · 1 adult')).toBeInTheDocument();
    expect(screen.getByText('GST 5%')).toBeInTheDocument();
    expect(screen.getByText('₹5,200.00')).toBeInTheDocument();
    expect(screen.getByText(/Fare kept for \d+:\d\d/)).toBeInTheDocument();
    expect(screen.getByText(/Seats are not reserved yet/)).toBeInTheDocument();
  });

  it('shows the stop and the layover of a connecting flight', async () => {
    vi.mocked(flightApi.getTrip).mockResolvedValue(twoLegs());
    open();

    expect(await screen.findByText('Stop at HYD · 1h 15m layover')).toBeInTheDocument();
    expect(screen.getByText('+1 day')).toBeInTheDocument();
    expect(screen.getByText(/1 stop via HYD/)).toBeInTheDocument();
  });

  it('continues to the passenger details', async () => {
    const { user, router } = open();

    await user.click(await screen.findByRole('button', { name: 'Continue to passenger details' }));

    expect(currentLocation(router)).toBe('/book/flight/trip-1');
  });

  it('makes the customer accept a changed price before continuing', async () => {
    vi.mocked(flightApi.getTrip).mockResolvedValue(tripFixture({ priceChanged: true, previousTotal: 4900 }));
    const { user, router } = open();

    expect(await screen.findByText('The price changed')).toBeInTheDocument();
    expect(screen.getByText(/it was ₹4,900\.00 in the search results/)).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Continue to passenger details' });
    expect(next).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'I accept the new price of ₹5,200.00' }));
    expect(next).toBeEnabled();
    await user.click(next);

    expect(currentLocation(router)).toBe('/book/flight/trip-1');
  });

  it('shows a round trip with both directions', async () => {
    const trip = tripFixture({ tripType: 'ROUND_TRIP', title: 'Delhi to Mumbai and back' });
    vi.mocked(flightApi.getTrip).mockResolvedValue({
      ...trip,
      slices: [trip.slices[0]!, { ...trip.slices[0]!, origin: BOM, destination: DEL, flightNumber: 'AI 505', departureLocal: '2099-03-14T18:00', arrivalLocal: '2099-03-14T20:10',
        segments: [{ flightNumber: 'AI 505', origin: 'BOM', destination: 'DEL', departureLocal: '2099-03-14T18:00', arrivalLocal: '2099-03-14T20:10', durationMinutes: 130 }] }],
    });
    open();

    expect(await screen.findByRole('region', { name: 'Outbound flight' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Return flight' })).toBeInTheDocument();
    expect(screen.getByText('Round trip · Economy · 1 adult')).toBeInTheDocument();
  });

  it('tells when the fare has expired', async () => {
    vi.mocked(flightApi.getTrip).mockRejectedValue(new ApiError(404, 'OFFER_EXPIRED', 'Offer expired'));
    open();

    expect(await screen.findByText('This fare has expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search flights' })).toHaveAttribute('href', '/flights');
  });
});

describe('PassengerDetailsPage', () => {
  const open = () => renderRoutes([{ path: '/book/flight/:tripOfferId', element: <PassengerDetailsPage /> }, ...sink.slice(1)],
    { path: '/book/flight/trip-1', auth: auth() });
  const family = () => tripFixture({ passengers: { adults: 2, children: 1, infants: 1 } });
  const international = () => tripFixture({ international: true, passengers: { adults: 1, children: 0, infants: 0 } });
  const saved = (overrides: Partial<Passenger> = {}): Passenger => ({
    id: 'sp1', passengerType: 'ADULT', firstName: 'Ravi', lastName: 'Kumar', dateOfBirth: '1985-02-03', gender: 'MALE', nationality: 'IN',
    hasPassport: true, passportNumberMasked: '••••4567', passportExpiry: '2105-01-01', passportCountry: 'IN', ...overrides,
  });

  it('asks for every traveller (adults, children, infants) and prefills the lead passenger and the contact', async () => {
    vi.mocked(flightApi.getTrip).mockResolvedValue(family());
    open();

    for (const label of ['Adult 1', 'Adult 2', 'Child 1', 'Infant 1']) {
      expect(await screen.findByRole('heading', { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByLabelText('First name')[0]).toHaveValue('Asha');
    expect(screen.getAllByLabelText('Last name')[0]).toHaveValue('Rao');
    expect(screen.getByLabelText('Email')).toHaveValue('asha@example.com');
    await waitFor(() => expect(screen.getByLabelText('Phone')).toHaveValue('+91 97000 00000'));
    expect(screen.getByText('Age 2–11 on the travel date')).toBeInTheDocument();
    expect(screen.getByText('Under 2 on every flight')).toBeInTheDocument();
    expect(screen.queryByLabelText('Passport number')).not.toBeInTheDocument();
    expect(screen.getByText('Delhi to Mumbai')).toBeInTheDocument();
  });

  it('does not ask for passport details on a domestic trip but does on an international one', async () => {
    vi.mocked(flightApi.getTrip).mockResolvedValue(international());
    open();

    expect(await screen.findByLabelText('Passport number')).toBeInTheDocument();
    expect(screen.getByLabelText('Passport expiry')).toBeInTheDocument();
    expect(screen.getByLabelText('Issuing country')).toBeInTheDocument();
  });

  it('explains an invalid child or infant age and does not continue', async () => {
    vi.mocked(flightApi.getTrip).mockResolvedValue(tripFixture({ passengers: { adults: 1, children: 1, infants: 1 } }));
    const { user, router } = open();
    await screen.findByRole('heading', { name: 'Child 1' });
    const dates = screen.getAllByLabelText(/Date of birth/);

    fireEvent.change(dates[1]!, { target: { value: '2098-01-01' } });
    fireEvent.change(dates[2]!, { target: { value: '2095-01-01' } });
    await user.type(screen.getAllByLabelText('First name')[1]!, 'Mini');
    await user.type(screen.getAllByLabelText('Last name')[1]!, 'Rao');
    await user.type(screen.getAllByLabelText('First name')[2]!, 'Baby');
    await user.type(screen.getAllByLabelText('Last name')[2]!, 'Rao');
    await waitFor(() => expect(screen.getByLabelText('Phone')).toHaveValue('+91 97000 00000'));
    await user.click(screen.getByRole('button', { name: 'Review booking' }));

    expect(await screen.findByText(/A child must be at least 2 on the travel date/)).toBeInTheDocument();
    expect(screen.getByText(/An infant must be under 2 on every flight/)).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/book/flight/trip-1');
  });

  it('keeps the details for the review step, and keeps the passport number out of the browser storage', async () => {
    vi.mocked(flightApi.getTrip).mockResolvedValue(international());
    const { user, router } = open();
    await screen.findByLabelText('Passport number');
    await waitFor(() => expect(screen.getByLabelText('Phone')).toHaveValue('+91 97000 00000'));

    await user.type(screen.getByLabelText('Passport number'), 'n1234567');
    fireEvent.change(screen.getByLabelText('Passport expiry'), { target: { value: '2105-01-01' } });
    await user.selectOptions(screen.getByLabelText('Issuing country'), 'IN');
    await user.type(screen.getByLabelText(/Coupon code/), 'welcome10');
    await user.click(screen.getByRole('button', { name: 'Review booking' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/book/flight/trip-1/review'));
    const draft = loadFlightDraft('trip-1');
    expect(draft?.passengers[0]).toMatchObject({ firstName: 'Asha', lastName: 'Rao', passportExpiry: '2105-01-01', passportCountry: 'IN' });
    expect(draft?.couponCode).toBe('WELCOME10');
    expect(draft?.contact).toEqual({ email: 'asha@example.com', phone: '+91 97000 00000' });
    expect(JSON.stringify(sessionStorage)).not.toContain('N1234567');
    expect(recallPassportNumbers('trip-1')).toEqual(['N1234567']);
  });

  it('fills a traveller from the saved passengers of the same type (without the passport number)', async () => {
    vi.mocked(flightApi.getTrip).mockResolvedValue(international());
    vi.mocked(accountApi.listPassengers).mockResolvedValue([saved(), saved({ id: 'sp2', passengerType: 'CHILD', firstName: 'Tiny' })]);
    const { user } = open();

    const picker = await screen.findByLabelText('Saved passenger for Adult 1');
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Ravi Kumar']);
    await user.selectOptions(picker, 'sp1');

    expect(screen.getByLabelText('First name')).toHaveValue('Ravi');
    expect(screen.getByLabelText('Last name')).toHaveValue('Kumar');
    expect(screen.getByLabelText(/Date of birth/)).toHaveValue('Sun, 3 Feb 1985');
    expect(screen.getByLabelText('Passport expiry')).toHaveValue('Thu, 1 Jan 2105');
    expect(screen.getByLabelText('Passport number')).toHaveValue('');
    expect(screen.getByText(/Saved passport ••••4567: please type the number again/)).toBeInTheDocument();
  });

  it('previews a coupon for the flight total', async () => {
    vi.mocked(bookingApi.checkCoupon).mockResolvedValue({ code: 'WELCOME10', title: 'Welcome offer', description: '10% off', discount: 520, totalAfterDiscount: 4680, currency: 'INR' });
    const { user } = open();

    await user.type(await screen.findByLabelText(/Coupon code/), 'WELCOME10');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/Welcome offer: you save ₹520.00/)).toBeInTheDocument();
    expect(bookingApi.checkCoupon).toHaveBeenCalledWith({ code: 'WELCOME10', bookingType: 'FLIGHT', amount: 5200 });
  });

  it('tells when the fare has expired', async () => {
    vi.mocked(flightApi.getTrip).mockRejectedValue(new ApiError(404, 'OFFER_EXPIRED', 'Offer expired'));
    open();

    expect(await screen.findByText('This fare has expired')).toBeInTheDocument();
  });
});

describe('FlightReviewPage', () => {
  const draft: FlightDraft = {
    tripOfferId: 'trip-1',
    contact: { email: 'asha@example.com', phone: '+91 98000 00000' },
    passengers: [{ passengerType: 'ADULT', firstName: 'Asha', lastName: 'Rao', dateOfBirth: '1990-04-02', gender: 'FEMALE', nationality: 'IN', passportExpiry: '', passportCountry: '' }],
    couponCode: 'WELCOME10',
  };
  const open = () => renderRoutes([{ path: '/book/flight/:tripOfferId/review', element: <FlightReviewPage /> }, { path: '/book/flight/:tripOfferId', element: <p>passenger page</p> }, sink[2]!],
    { path: '/book/flight/trip-1/review', auth: auth() });

  it('sends the customer back to the passenger details when there is nothing to review', async () => {
    const { router } = open();

    await waitFor(() => expect(currentLocation(router)).toBe('/book/flight/trip-1'));
  });

  it('sends the customer back when a passport number is needed but was lost (never stored in the browser)', async () => {
    vi.mocked(flightApi.getTrip).mockResolvedValue(tripFixture({ international: true }));
    saveFlightDraft(draft);
    const { router } = open();

    await waitFor(() => expect(currentLocation(router)).toBe('/book/flight/trip-1'));
  });

  it('shows the flights, passengers, coupon, cancellation policy and the price from the trip offer', async () => {
    saveFlightDraft(draft);
    open();

    expect(await screen.findByRole('heading', { name: 'Review your booking' })).toBeInTheDocument();
    expect(screen.getByText('Delhi to Mumbai')).toBeInTheDocument();
    expect(screen.getByText('Adult 1: Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('asha@example.com · +91 98000 00000')).toBeInTheDocument();
    expect(screen.getByText('WELCOME10')).toBeInTheDocument();
    expect(screen.getByText('Non-refundable: the full fare is charged if you cancel.')).toBeInTheDocument();
    expect(screen.getByText('₹5,200.00')).toBeInTheDocument();
    expect(screen.getByText('Nothing is charged yet.', { exact: false })).toBeInTheDocument();
  });

  it('needs the terms accepted before booking', async () => {
    saveFlightDraft(draft);
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Confirm and continue to payment' }));

    expect(screen.getByText('Please accept to continue')).toBeInTheDocument();
    expect(bookingApi.createFlightBooking).not.toHaveBeenCalled();
  });

  it('books with only the customer-entered data (passport included on an international trip), then goes to payment', async () => {
    vi.mocked(flightApi.getTrip).mockResolvedValue(tripFixture({ international: true }));
    saveFlightDraft({ ...draft, passengers: [{ ...draft.passengers[0]!, passportExpiry: '2105-01-01', passportCountry: 'IN', gender: '' }] });
    rememberPassportNumbers('trip-1', ['N1234567']);
    vi.mocked(bookingApi.createFlightBooking).mockResolvedValue(bookingFixture({ id: 'f9', type: 'FLIGHT', status: 'INITIATED' }));
    const { user, router } = open();

    expect(await screen.findByText(/passport ••••4567/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /I accept the fare rules/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm and continue to payment' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/my-trips/f9/pay'));
    const [body, key] = vi.mocked(bookingApi.createFlightBooking).mock.calls[0] ?? [];
    expect(body).toEqual({
      tripOfferId: 'trip-1',
      contact: draft.contact,
      passengers: [{ passengerType: 'ADULT', firstName: 'Asha', lastName: 'Rao', dateOfBirth: '1990-04-02', nationality: 'IN', passportNumber: 'N1234567', passportExpiry: '2105-01-01', passportCountry: 'IN' }],
      couponCode: 'WELCOME10',
    });
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(loadFlightDraft('trip-1')).toBeNull();
    expect(recallPassportNumbers('trip-1')).toEqual([]);
  });

  it('sends no passport data for a domestic trip', async () => {
    saveFlightDraft({ ...draft, passengers: [{ ...draft.passengers[0]!, passportExpiry: '2105-01-01', passportCountry: 'IN' }] });
    vi.mocked(bookingApi.createFlightBooking).mockResolvedValue(bookingFixture({ id: 'f9', type: 'FLIGHT' }));
    const { user } = open();

    await user.click(await screen.findByRole('checkbox', { name: /I accept the fare rules/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm and continue to payment' }));

    await waitFor(() => expect(bookingApi.createFlightBooking).toHaveBeenCalled());
    const body = vi.mocked(bookingApi.createFlightBooking).mock.calls[0]?.[0];
    expect(JSON.stringify(body)).not.toContain('passport');
  });

  it('reuses the same key when the customer retries after an error, so no second booking is made', async () => {
    saveFlightDraft(draft);
    vi.mocked(bookingApi.createFlightBooking)
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.'))
      .mockResolvedValueOnce(bookingFixture({ id: 'f9', type: 'FLIGHT' }));
    const { user } = open();

    await user.click(await screen.findByRole('checkbox', { name: /I accept the fare rules/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm and continue to payment' }));
    expect(await screen.findByText('Cannot reach the server. Check your connection and try again.')).toBeInTheDocument();
    expect(loadFlightDraft('trip-1')?.idempotencyKey).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Confirm and continue to payment' }));

    await waitFor(() => expect(bookingApi.createFlightBooking).toHaveBeenCalledTimes(2));
    const keys = vi.mocked(bookingApi.createFlightBooking).mock.calls.map((call) => call[1]);
    expect(keys[0]).toBe(keys[1]);
  });

  it('does not bounce back to the passenger details while the (lazy) payment page loads', async () => {
    saveFlightDraft(draft);
    vi.mocked(bookingApi.createFlightBooking).mockResolvedValue(bookingFixture({ id: 'f9', type: 'FLIGHT' }));
    const { user, router } = renderRoutes([
      { path: '/book/flight/:tripOfferId/review', element: <FlightReviewPage /> },
      { path: '/book/flight/:tripOfferId', element: <p>passenger page</p> },
      { path: '/my-trips/:id/pay', lazy: async () => { await new Promise((resolve) => setTimeout(resolve, 150)); return { Component: () => <p>payment page</p> }; } },
    ], { path: '/book/flight/trip-1/review', auth: auth() });

    await user.click(await screen.findByRole('checkbox', { name: /I accept the fare rules/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm and continue to payment' }));

    expect(await screen.findByText('payment page')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/my-trips/f9/pay');
  });
});
