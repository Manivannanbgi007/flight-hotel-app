import { screen, waitFor, within } from '@testing-library/react';

import { documentApi } from '@/features/documents/documentApi';
import { paymentApi } from '@/features/payments/paymentApi';
import { ApiError } from '@/lib/api/apiError';
import { formatDateTime } from '@/lib/format';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { bookingApi } from './bookingApi';
import { BookingDetailsPage } from './BookingDetailsPage';
import { CancelBookingPage } from './CancelBookingPage';
import { MyTripsPage } from './MyTripsPage';
import { bookingFixture, cancellationFixture, cancellationQuoteFixture, refundFixture, summaryFixture } from './testData';
import type { BookingDetails } from './types';

vi.mock('./bookingApi', () => ({
  bookingApi: { details: vi.fn(), timeline: vi.fn(), list: vi.fn(), cancellationQuote: vi.fn(), cancel: vi.fn() },
}));
vi.mock('@/features/payments/paymentApi', () => ({ paymentApi: { forBooking: vi.fn(), invoiceForBooking: vi.fn() } }));
vi.mock('@/features/documents/documentApi', () => ({ documentApi: { list: vi.fn(), download: vi.fn() } }));

const auth = () => fakeAuth({ user: customer });
const hotel = bookingFixture().hotel!;
const confirmed = (overrides: Partial<BookingDetails> = {}) => bookingFixture({
  status: 'CONFIRMED', paymentStatus: 'PAID', canPay: false, canCancel: true, confirmedAt: '2099-03-01T10:02:00Z',
  hotel: { ...hotel, confirmationNumber: 'SB123456' }, ...overrides,
});
const KEY = /^[A-Za-z0-9_-]{8,100}$/;

beforeEach(() => {
  vi.mocked(documentApi.list).mockResolvedValue([]);
  vi.mocked(bookingApi.details).mockResolvedValue(confirmed());
  vi.mocked(bookingApi.timeline).mockResolvedValue([]);
  vi.mocked(bookingApi.cancellationQuote).mockResolvedValue(cancellationQuoteFixture());
  vi.mocked(paymentApi.forBooking).mockResolvedValue([]);
  vi.mocked(paymentApi.invoiceForBooking).mockRejectedValue(new ApiError(404, 'INVOICE_NOT_FOUND', 'Not found'));
});

describe('CancelBookingPage', () => {
  const open = () => renderRoutes([
    { path: '/my-trips/:bookingId/cancel', element: <CancelBookingPage /> },
    { path: '/my-trips/:bookingId', element: <BookingDetailsPage /> },
  ], { path: '/my-trips/b1/cancel', auth: auth() });

  it('shows what is paid, kept and refunded, the fee rule, the deadlines and the policy', async () => {
    open();

    expect(await screen.findByRole('heading', { name: 'Cancel booking' })).toBeInTheDocument();
    const figures = await screen.findByRole('region', { name: 'Refund calculation' });
    expect(within(figures).getByText('₹2,625.00')).toBeInTheDocument();
    expect(within(figures).getByText('₹656.25')).toBeInTheDocument();
    expect(within(figures).getByText('25% of the stay price (₹2,625)')).toBeInTheDocument();
    expect(within(figures).getByText('₹1,968.75')).toBeInTheDocument();
    expect(within(figures).getByText(formatDateTime('2099-03-08T08:30:00Z'))).toBeInTheDocument();
    expect(within(figures).getByText(formatDateTime('2099-03-10T08:30:00Z'))).toBeInTheDocument();
    expect(within(figures).getByText(/after that 25% of the total is charged/)).toBeInTheDocument();
    expect(screen.queryByText(/nothing will be refunded/i)).not.toBeInTheDocument();
    expect(bookingApi.cancellationQuote).toHaveBeenCalledWith('b1', false);
    expect(screen.getByRole('link', { name: 'Keep my booking' })).toHaveAttribute('href', '/my-trips/b1');
  });

  it('warns clearly when nothing will be refunded', async () => {
    vi.mocked(bookingApi.cancellationQuote).mockResolvedValue(cancellationQuoteFixture({
      cancellationFee: 2625, refundAmount: 0, freeCancellationUntil: null, feeDescription: 'Non-refundable rate',
    }));
    open();

    expect(await screen.findByText('Non-refundable: nothing will be refunded')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /nothing will be refunded/ })).not.toBeChecked();
  });

  it('keeps the button disabled until "I understand" is ticked, then sends a key and the refund the customer saw', async () => {
    vi.mocked(bookingApi.cancel).mockImplementation(async () => {
      vi.mocked(bookingApi.details).mockResolvedValue(confirmed({
        status: 'CANCELLATION_PENDING', canCancel: false, cancellation: cancellationFixture(),
      }));
      return cancellationFixture();
    });
    const { user, router } = open();
    const confirm = await screen.findByRole('button', { name: 'Confirm cancellation' });

    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Change of plans' }));
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(currentLocation(router)).toBe('/my-trips/b1'));
    const [id, body, key] = vi.mocked(bookingApi.cancel).mock.calls[0] ?? [];
    expect(id).toBe('b1');
    expect(body).toEqual({ reason: 'Change of plans', expectedRefundAmount: 1968.75 });
    expect(key).toMatch(KEY);
    expect((await screen.findAllByText('Cancellation in progress')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Cancellation requested/)).toBeInTheDocument();
  });

  it('sends the reason written under "Other", and no reason when none is given', async () => {
    vi.mocked(bookingApi.cancel).mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server.'));
    const { user } = open();
    await user.click(await screen.findByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    await waitFor(() => expect(bookingApi.cancel).toHaveBeenCalledTimes(1));
    expect(vi.mocked(bookingApi.cancel).mock.calls[0]?.[1]).toEqual({ expectedRefundAmount: 1968.75 });

    await user.click(screen.getByRole('radio', { name: 'Other' }));
    await user.type(screen.getByLabelText('Tell us more'), 'Visa did not arrive');
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));

    await waitFor(() => expect(bookingApi.cancel).toHaveBeenCalledTimes(2));
    expect(vi.mocked(bookingApi.cancel).mock.calls[1]?.[1]).toEqual({ reason: 'Visa did not arrive', expectedRefundAmount: 1968.75 });
  });

  it('reuses the same key when the same request is retried after a network error', async () => {
    vi.mocked(bookingApi.cancel)
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.'))
      .mockResolvedValueOnce(cancellationFixture());
    const { user } = open();
    await user.click(await screen.findByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));

    expect(await screen.findByText('Cannot reach the server. Check your connection and try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));

    await waitFor(() => expect(bookingApi.cancel).toHaveBeenCalledTimes(2));
    const keys = vi.mocked(bookingApi.cancel).mock.calls.map((call) => call[2]);
    expect(keys[0]).toBe(keys[1]);
  });

  it('shows the new figures when the quote changed, asks again and confirms them with a new key', async () => {
    vi.mocked(bookingApi.cancellationQuote)
      .mockResolvedValueOnce(cancellationQuoteFixture({ freeCancellation: true, cancellationFee: 0, refundAmount: 2625 }))
      .mockResolvedValue(cancellationQuoteFixture({ cancellationFee: 1050, refundAmount: 1575 }));
    vi.mocked(bookingApi.cancel)
      .mockRejectedValueOnce(new ApiError(409, 'CANCELLATION_QUOTE_CHANGED', 'The refund has changed.', [], 'corr-1',
        { refundAmount: 1575, cancellationFee: 1050 }))
      .mockResolvedValueOnce(cancellationFixture({ cancellationFee: 1050, refundAmount: 1575 }));
    const { user } = open();

    await user.click(await screen.findByRole('checkbox', { name: /₹2,625.00 will be refunded/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));

    const notice = (await screen.findByText('The refund has changed')).closest<HTMLElement>('[role="alert"]')!;
    expect(within(notice).getByText('₹1,575.00')).toBeInTheDocument();
    expect(within(notice).getByText(/cancellation fee ₹1,050.00/)).toBeInTheDocument();
    // The figures on screen are the new ones, and "I understand" must be ticked again for them.
    const figures = screen.getByRole('region', { name: 'Refund calculation' });
    await waitFor(() => expect(within(figures).getByText('₹1,050.00')).toBeInTheDocument());
    const understand = screen.getByRole('checkbox', { name: /₹1,575.00 will be refunded/ });
    expect(understand).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Confirm cancellation' })).toBeDisabled();

    await user.click(understand);
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));

    await waitFor(() => expect(bookingApi.cancel).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(bookingApi.cancel).mock.calls;
    expect(first?.[1]).toEqual({ expectedRefundAmount: 2625 });
    expect(second?.[1]).toEqual({ expectedRefundAmount: 1575 });
    expect(second?.[2]).toMatch(KEY);
    expect(second?.[2]).not.toBe(first?.[2]);
  });

  it('explains why a booking cannot be cancelled and offers no button', async () => {
    vi.mocked(bookingApi.cancellationQuote).mockResolvedValue(cancellationQuoteFixture({
      cancellable: false, reasonCode: 'TOO_LATE', message: 'Check-in has started, so this stay can no longer be cancelled online.',
    }));
    open();

    expect(await screen.findByText('It is too late to cancel online')).toBeInTheDocument();
    expect(screen.getByText('Check-in has started, so this stay can no longer be cancelled online.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm cancellation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Refund calculation' })).not.toBeInTheDocument();
  });

  it('says so when the booking stopped being cancellable while the page was open', async () => {
    vi.mocked(bookingApi.cancel).mockRejectedValue(new ApiError(409, 'BOOKING_NOT_CANCELLABLE',
      'This booking is already being cancelled.', [], 'corr-9', { reasonCode: 'CANCELLATION_IN_PROGRESS' }));
    const { user } = open();
    await user.click(await screen.findByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));

    expect(await screen.findByText('Cancellation already in progress')).toBeInTheDocument();
    expect(screen.getByText('This booking is already being cancelled.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-9')).toBeInTheDocument();
  });

  it('shows the support reference when the quote cannot be loaded', async () => {
    vi.mocked(bookingApi.cancellationQuote).mockRejectedValue(
      new ApiError(500, 'HTTP_500', 'Something went wrong on our side. Please try again later.', [], 'corr-123'));
    open();

    expect(await screen.findByText('We could not work out the refund')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says when the booking does not exist, without a retry', async () => {
    vi.mocked(bookingApi.details).mockRejectedValue(new ApiError(404, 'BOOKING_NOT_FOUND', 'Not found.'));
    open();

    const error = await screen.findByRole('alert');
    expect(within(error).getByRole('heading', { name: 'Booking not found' })).toBeInTheDocument();
    expect(within(error).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Trips' })).toHaveAttribute('href', '/my-trips');
    expect(bookingApi.cancellationQuote).not.toHaveBeenCalled();
  });

  it('offers a retry when the booking cannot be loaded', async () => {
    vi.mocked(bookingApi.details)
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Booking service is not reachable.', [], 'corr-7'))
      .mockResolvedValueOnce(confirmed());
    const { user } = open();

    const error = await screen.findByRole('alert');
    expect(within(error).getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(error).toHaveTextContent('Support reference: corr-7');
    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Cancel booking' })).toBeInTheDocument();
  });

  it('names the airline and a one-day trip for a flight booking without a title', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(confirmed({
      type: 'FLIGHT', title: null, startDate: '2099-03-10', endDate: '2099-03-10', hotel: null,
    }));
    open();

    expect(await screen.findByText(/^Flight booking · 10 Mar 2099 · reference/)).toBeInTheDocument();
    expect(screen.getByText('Your booking is cancelled once the airline confirms. The refund then goes back to your original payment method.'))
      .toBeInTheDocument();
  });

  it('describes a hotel booking without title or dates', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(confirmed({ title: null, startDate: null, endDate: null }));
    open();

    expect(await screen.findByText(/^Hotel booking · reference/)).toBeInTheDocument();
    expect(screen.getByText(/once the hotel confirms/)).toBeInTheDocument();
  });

  it('shows a stay of several nights as a date range', async () => {
    open();

    expect(await screen.findByText(/^Sea Breeze Resort · 10 Mar 2099 to 12 Mar 2099 · reference/)).toBeInTheDocument();
  });
});

describe('BookingDetailsPage: cancellation and refunds', () => {
  const open = () => renderRoutes([{ path: '/my-trips/:bookingId', element: <BookingDetailsPage /> }],
    { path: '/my-trips/b1', auth: auth() });

  it('offers "Cancel booking" only when the server allows it', async () => {
    const { unmount } = open();
    expect(await screen.findByRole('link', { name: 'Cancel booking' })).toHaveAttribute('href', '/my-trips/b1/cancel');
    unmount();

    vi.mocked(bookingApi.details).mockResolvedValue(confirmed({ canCancel: false }));
    open();
    expect(await screen.findByText('SB123456')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cancel booking' })).not.toBeInTheDocument();
  });

  it('shows a cancellation in progress; the booking (and its confirmation number) stays valid until the hotel answers', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(confirmed({
      status: 'CANCELLATION_PENDING', canCancel: false, cancellation: cancellationFixture(),
    }));
    open();

    const section = await screen.findByRole('region', { name: 'Cancellation and refund' });
    expect(screen.getAllByText('Cancellation in progress').length).toBeGreaterThan(0);
    expect(within(section).getByText('Waiting for the hotel')).toBeInTheDocument();
    expect(within(section).getByText(/^You ·/)).toBeInTheDocument();
    expect(within(section).getByText('Change of plans')).toBeInTheDocument();
    expect(within(section).getByText('₹656.25')).toBeInTheDocument();
    expect(within(section).getByText('₹1,968.75')).toBeInTheDocument();
    expect(screen.getByText('SB123456')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cancel booking' })).not.toBeInTheDocument();
  });

  it('shows a cancelled booking with a partial refund: the hotel reference, the refunds and what came back', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(confirmed({
      status: 'REFUNDED', paymentStatus: 'PARTIALLY_REFUNDED', canCancel: false, refundedAmount: 1968.75,
      cancellation: cancellationFixture({ status: 'CONFIRMED', completedAt: '2099-03-02T10:01:00Z', supplierReference: 'CXL-778' }),
      refunds: [refundFixture({ status: 'COMPLETED', completedAt: '2099-03-03T09:00:00Z' })],
    }));
    open();

    const section = await screen.findByRole('region', { name: 'Cancellation and refund' });
    expect(screen.getAllByText('Partly refunded').length).toBeGreaterThan(0);
    expect(screen.getByText(/The cancellation fee was kept/)).toBeInTheDocument();
    expect(within(section).getByText('Cancelled')).toBeInTheDocument();
    expect(within(section).getByText('Hotel cancellation number')).toBeInTheDocument();
    expect(within(section).getByText('CXL-778')).toBeInTheDocument();
    const refunds = within(section).getByRole('list', { name: 'Refunds' });
    expect(within(refunds).getByText('₹1,968.75 · Cancellation')).toBeInTheDocument();
    expect(within(refunds).getByText('Refunded')).toBeInTheDocument();
    expect(within(section).getByText(/Refunded so far/)).toHaveTextContent('Refunded so far: ₹1,968.75');
    // Golden rule 3 the other way round: a cancelled stay no longer shows the hotel's confirmation number.
    expect(screen.queryByText('SB123456')).not.toBeInTheDocument();
  });

  it('explains a rejected cancellation as a notice: the booking is still valid', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(confirmed({
      cancellation: cancellationFixture({
        status: 'REJECTED', completedAt: '2099-03-02T10:01:00Z', failureReason: 'SUPPLIER_REFUSED',
        failureMessage: 'The hotel does not allow cancellations this close to check-in.',
      }),
    }));
    open();

    const section = await screen.findByRole('region', { name: 'Cancellation and refund' });
    const notice = within(section).getByRole('alert');
    expect(notice).toHaveTextContent('The hotel did not accept the cancellation');
    expect(notice).toHaveTextContent('The hotel does not allow cancellations this close to check-in.');
    expect(notice).toHaveTextContent('Your booking is still valid.');
    expect(within(section).getByText('Not cancelled')).toBeInTheDocument();
    expect(within(section).queryByText('SUPPLIER_REFUSED')).not.toBeInTheDocument();
    expect(screen.getByText('SB123456')).toBeInTheDocument();
  });
});

describe('MyTripsPage: cancellations', () => {
  const page = (content: ReturnType<typeof summaryFixture>[]) => ({ content, page: 0, size: 10, totalElements: content.length, totalPages: 1 });

  it('offers Cancel for bookings that allow it and labels the cancellation states', async () => {
    vi.mocked(bookingApi.list).mockResolvedValue(page([
      summaryFixture({ id: 'b1', reference: 'HT-AAAA0001', canCancel: true }),
      summaryFixture({ id: 'b2', reference: 'HT-AAAA0002', status: 'CANCELLATION_PENDING' }),
      summaryFixture({ id: 'b3', reference: 'HT-AAAA0003', status: 'REFUND_PENDING', paymentStatus: 'REFUND_PENDING' }),
      summaryFixture({ id: 'b4', reference: 'HT-AAAA0004', status: 'REFUNDED', paymentStatus: 'PARTIALLY_REFUNDED' }),
      summaryFixture({ id: 'b5', reference: 'HT-AAAA0005', status: 'REFUNDED', paymentStatus: 'REFUNDED' }),
    ]));
    renderRoutes([{ path: '/my-trips', element: <MyTripsPage /> }], { path: '/my-trips', auth: auth() });

    const list = await screen.findByRole('list', { name: 'Bookings' });
    expect(within(list).getByRole('link', { name: 'Cancel booking HT-AAAA0001' })).toHaveAttribute('href', '/my-trips/b1/cancel');
    expect(within(list).getAllByRole('link', { name: /^Cancel booking/ })).toHaveLength(1);
    expect(within(list).getByText('Cancellation in progress')).toBeInTheDocument();
    expect(within(list).getByText('Refund in progress')).toBeInTheDocument();
    expect(within(list).getByText('Partly refunded')).toBeInTheDocument();
    expect(within(list).getByText('Refunded')).toBeInTheDocument();
  });
});
