import { screen, waitFor, within } from '@testing-library/react';
import { strFromU8, unzipSync } from 'fflate';

import { bookingApi } from '@/features/bookings/bookingApi';
import { bookingFixture } from '@/features/bookings/testData';
import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { paymentApi } from './paymentApi';
import { PaymentHistoryPage } from './PaymentHistoryPage';
import { PaymentPage } from './PaymentPage';
import { PaymentResultPage } from './PaymentResultPage';
import { loadRazorpay, type RazorpayOptions } from './razorpay';
import type { PaymentOrder, PaymentResult, PaymentSummary } from './types';

vi.mock('@/features/bookings/bookingApi', () => ({ bookingApi: { details: vi.fn() } }));
// The stay card's photo: none here, so the card draws its gradient.
vi.mock('@/features/hotels/hotelApi', () => ({ hotelApi: { details: vi.fn(() => Promise.reject(new Error('no photo'))) } }));
vi.mock('@/features/settings/usePublicSettings', () => ({ usePublicSettings: () => ({ settings: { siteName: 'FlightHotel' } }) }));
vi.mock('./paymentApi', () => ({
  paymentApi: { createOrder: vi.fn(), verify: vi.fn(), reportFailure: vi.fn(), demoCheckout: vi.fn(), history: vi.fn(), historySummary: vi.fn(), get: vi.fn() },
}));
vi.mock('./razorpay', async (importOriginal) => ({ ...(await importOriginal<typeof import('./razorpay')>()), loadRazorpay: vi.fn() }));

const auth = () => fakeAuth({ user: customer });

const order = (overrides: Partial<PaymentOrder> = {}): PaymentOrder => ({
  paymentId: 'p1', bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', provider: 'DEMO', orderId: 'order_demo_1', keyId: null,
  amount: 2625, currency: 'INR', description: 'Sea Breeze Resort · 2 nights · 1 room', contactEmail: 'asha@example.com',
  paymentDeadline: new Date(Date.now() + 15 * 60_000).toISOString(), status: 'INITIATED', ...overrides,
});

const result = (overrides: Partial<PaymentResult> = {}): PaymentResult => ({
  paymentId: 'p1', bookingId: 'b1', status: 'SUCCESS', method: 'demo', amount: 2625, currency: 'INR',
  failureCode: null, failureMessage: null, ...overrides,
});

describe('PaymentPage', () => {
  const open = () => renderRoutes([
    { path: '/my-trips/:bookingId/pay', element: <PaymentPage /> },
    { path: '/my-trips/:bookingId/result', element: <p>result page</p> },
  ], { path: '/my-trips/b1/pay', auth: auth() });

  it('waits while the hotel holds the room', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ status: 'INITIATED', canPay: false, priceItems: [], totalAmount: 0 }));
    open();

    expect(await screen.findByText('Securing your room…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();
  });

  it('shows the price breakdown from the server and the countdown for a held room', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture());
    open();

    expect(await screen.findByRole('heading', { name: 'Payment' })).toBeInTheDocument();
    expect(screen.getByText('Room charges · 2 nights × 1 room')).toBeInTheDocument();
    expect(screen.getByText('GST 5%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay ₹2,625.00' })).toBeInTheDocument();
    expect(screen.getByText(/Pay within \d+:\d\d/)).toBeInTheDocument();
  });

  it('opens the labelled demo payment panel and completes the payment through the server check', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture());
    vi.mocked(paymentApi.createOrder).mockResolvedValue(order());
    vi.mocked(paymentApi.demoCheckout).mockResolvedValue({ orderId: 'order_demo_1', paymentId: 'pay_demo_ok_1', signature: 'sig' });
    vi.mocked(paymentApi.verify).mockResolvedValue(result());
    const { user, router } = open();

    await user.click(await screen.findByRole('button', { name: 'Pay ₹2,625.00' }));
    const demo = await screen.findByRole('region', { name: 'Demo payment' });
    expect(within(demo).getByText(/No real money is used/)).toBeInTheDocument();
    await user.click(within(demo).getByRole('button', { name: 'Pay ₹2,625.00' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/my-trips/b1/result'));
    expect(paymentApi.createOrder).toHaveBeenCalledWith('b1', expect.stringMatching(/^[A-Za-z0-9_-]{8,100}$/));
    expect(paymentApi.demoCheckout).toHaveBeenCalledWith('order_demo_1', 'pay');
    // The browser's answer is passed to the server unchanged: the server verifies it.
    expect(paymentApi.verify).toHaveBeenCalledWith({ orderId: 'order_demo_1', paymentId: 'pay_demo_ok_1', signature: 'sig' });
  });

  it('the demo Fail button closes the attempt and lets the customer try again', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture());
    vi.mocked(paymentApi.createOrder).mockResolvedValue(order());
    vi.mocked(paymentApi.demoCheckout).mockResolvedValue({ orderId: 'order_demo_1', paymentId: 'pay_demo_fail_1', signature: 'sig' });
    vi.mocked(paymentApi.reportFailure).mockResolvedValue(result({ status: 'FAILED', failureCode: 'DEMO_DECLINED' }));
    const { user, router } = open();

    await user.click(await screen.findByRole('button', { name: 'Pay ₹2,625.00' }));
    await user.click(await screen.findByRole('button', { name: 'Fail the payment' }));

    expect(await screen.findByText(/Your payment did not go through. No money was taken. You can try again./)).toBeInTheDocument();
    expect(paymentApi.reportFailure).toHaveBeenCalledWith('order_demo_1', 'pay_demo_fail_1');
    expect(paymentApi.verify).not.toHaveBeenCalled();
    expect(currentLocation(router)).toBe('/my-trips/b1/pay');
    // The demo panel is gone and the normal Pay button is back for a new attempt.
    expect(screen.queryByRole('region', { name: 'Demo payment' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay ₹2,625.00' })).toBeEnabled();
  });

  it('shows a refused verification instead of pretending it worked', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture());
    vi.mocked(paymentApi.createOrder).mockResolvedValue(order());
    vi.mocked(paymentApi.demoCheckout).mockResolvedValue({ orderId: 'order_demo_1', paymentId: 'pay_demo_ok_1', signature: 'bad' });
    vi.mocked(paymentApi.verify).mockRejectedValue(new ApiError(400, 'INVALID_PAYMENT_SIGNATURE', 'The payment could not be verified.'));
    const { user, router } = open();

    await user.click(await screen.findByRole('button', { name: 'Pay ₹2,625.00' }));
    const demo = await screen.findByRole('region', { name: 'Demo payment' });
    await user.click(within(demo).getByRole('button', { name: 'Pay ₹2,625.00' }));

    expect(await screen.findByText('The payment could not be verified.')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/my-trips/b1/pay');
  });

  it('opens Razorpay Checkout with the server order and verifies what it reports', async () => {
    const captured: { options?: RazorpayOptions } = {};
    const opened = vi.fn();
    vi.mocked(loadRazorpay).mockResolvedValue(function FakeRazorpay(this: unknown, given: RazorpayOptions) {
      captured.options = given;
      return { open: opened, on: vi.fn() };
    } as unknown as Awaited<ReturnType<typeof loadRazorpay>>);
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ demo: false }));
    vi.mocked(paymentApi.createOrder).mockResolvedValue(order({ provider: 'RAZORPAY', orderId: 'order_rzp_1', keyId: 'rzp_test_abc' }));
    vi.mocked(paymentApi.verify).mockResolvedValue(result({ method: 'upi' }));
    const { user, router } = open();

    await user.click(await screen.findByRole('button', { name: 'Pay ₹2,625.00' }));

    await waitFor(() => expect(opened).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Demo payment' })).not.toBeInTheDocument();
    expect(captured.options).toMatchObject({ key: 'rzp_test_abc', order_id: 'order_rzp_1', amount: 262500, currency: 'INR',
      name: 'FlightHotel', prefill: { email: 'asha@example.com' } });
    captured.options?.handler({ razorpay_order_id: 'order_rzp_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig_1' });

    await waitFor(() => expect(currentLocation(router)).toBe('/my-trips/b1/result'));
    expect(paymentApi.verify).toHaveBeenCalledWith({ orderId: 'order_rzp_1', paymentId: 'pay_1', signature: 'sig_1' });
  });

  it('tells the server when Razorpay Checkout reports a failed payment', async () => {
    const handlers: Record<string, (failure: unknown) => void> = {};
    vi.mocked(loadRazorpay).mockResolvedValue(function FakeRazorpay() {
      return { open: vi.fn(), on: (event: string, handler: (failure: unknown) => void) => { handlers[event] = handler; } };
    } as unknown as Awaited<ReturnType<typeof loadRazorpay>>);
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ demo: false }));
    vi.mocked(paymentApi.createOrder).mockResolvedValue(order({ provider: 'RAZORPAY', orderId: 'order_rzp_1', keyId: 'rzp_test_abc' }));
    vi.mocked(paymentApi.reportFailure).mockResolvedValue(result({ status: 'FAILED' }));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Pay ₹2,625.00' }));
    await waitFor(() => expect(handlers['payment.failed']).toBeDefined());
    handlers['payment.failed']?.({ error: { metadata: { payment_id: 'pay_bad' } } });

    await waitFor(() => expect(paymentApi.reportFailure).toHaveBeenCalledWith('order_rzp_1', 'pay_bad'));
    expect(await screen.findByText(/No money was taken/)).toBeInTheDocument();
  });

  it('explains when the payment window could not be opened (script blocked)', async () => {
    vi.mocked(loadRazorpay).mockRejectedValue(new Error('blocked'));
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ demo: false }));
    vi.mocked(paymentApi.createOrder).mockResolvedValue(order({ provider: 'RAZORPAY', keyId: 'rzp_test_abc' }));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Pay ₹2,625.00' }));

    expect(await screen.findByText(/The payment window could not be opened/)).toBeInTheDocument();
  });

  it('shows a refused order (for example the time to pay is over)', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture());
    vi.mocked(paymentApi.createOrder).mockRejectedValue(new ApiError(409, 'PAYMENT_WINDOW_CLOSED', 'The time to pay for this booking is over.'));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Pay ₹2,625.00' }));

    expect(await screen.findByText('The time to pay for this booking is over.')).toBeInTheDocument();
  });

  it('warns about an earlier failed payment and about a coupon that could not be applied', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ paymentStatus: 'PAYMENT_FAILED', couponNote: 'The coupon needs a higher booking amount.' }));
    open();

    expect(await screen.findByText('Your last payment did not go through')).toBeInTheDocument();
    expect(screen.getByText('The coupon needs a higher booking amount.')).toBeInTheDocument();
  });

  it.each([
    ['SOLD_OUT', 'The room was booked by someone else'],
    ['PRICE_CHANGED', 'The price changed since you checked'],
    ['QUOTE_EXPIRED', 'Prices are held for 15 minutes'],
  ])('a failed hold (%s) says what to do and that nothing was charged', async (reason, advice) => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ status: 'FAILED', canPay: false, failureReason: reason, failureMessage: null }));
    open();

    expect(await screen.findByText('We could not book this room')).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(advice)).length).toBeGreaterThan(0);
    expect(screen.getByText('Nothing was charged.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose another room' })).toHaveAttribute('href', '/hotels/sea-breeze-resort-goa');
  });

  it('says what happens around the payment: refund if not confirmed, the confirmation e-mail, the cancellation terms', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture());
    open();

    const notes = within(await screen.findByRole('region', { name: 'Good to know' }));
    const cards = notes.getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent(/^Refunded if not confirmedIf the hotel cannot confirm your booking, the payment is refunded in full\.$/);
    expect(cards[1]).toHaveTextContent(/^Confirmation by e-mail/);
    expect(cards[2]).toHaveTextContent(/^Cancellation/);
    expect(notes.getByText('asha@example.com')).toBeInTheDocument();
    expect(notes.getByText('Free cancellation until 2 days before check-in.')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Ways to pay' })).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['Cards', 'UPI', 'Net banking']);
  });

  it('stops the payment once the time to pay is over, even before the server releases the room', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ paymentDeadline: new Date(Date.now() - 60_000).toISOString() }));
    open();

    expect(await screen.findByText('The time to pay is over. The room is being released.')).toBeInTheDocument();
    expect(screen.getByText('Nothing was charged.')).toBeInTheDocument();
    expect(screen.queryByText(/Pay within/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay ₹2,625.00' })).toBeDisabled();
  });

  it('an expired booking is not payable', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ status: 'EXPIRED', canPay: false, failureReason: 'PAYMENT_TIMEOUT' }));
    open();

    expect(await screen.findByText('This booking expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();
  });

  it('moves on to the result page once the payment was received', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ status: 'SUPPLIER_PENDING', canPay: false }));
    const { router } = open();

    await waitFor(() => expect(currentLocation(router)).toBe('/my-trips/b1/result'));
  });
});

describe('PaymentResultPage', () => {
  const open = () => renderRoutes([{ path: '/my-trips/:bookingId/result', element: <PaymentResultPage /> }],
    { path: '/my-trips/b1/result', auth: auth() });

  it('does not call a booking confirmed just because the payment succeeded', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ status: 'SUPPLIER_PENDING', paymentStatus: 'PAID', canPay: false }));
    open();

    expect(await screen.findByText('Payment received. Confirming with the hotel…')).toBeInTheDocument();
    expect(screen.queryByText('Your booking is confirmed')).not.toBeInTheDocument();
    expect(screen.queryByText('Hotel confirmation no.')).not.toBeInTheDocument();
  });

  it('shows the confirmation number once the hotel confirmed', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({
      status: 'CONFIRMED', paymentStatus: 'PAID', canPay: false,
      hotel: { ...bookingFixture().hotel!, confirmationNumber: 'SB123456' },
    }));
    open();

    expect(await screen.findByText('Your booking is confirmed')).toBeInTheDocument();
    expect(screen.getByText('SB123456')).toBeInTheDocument();
    expect(screen.getByText('HT-7K3M9Q2X')).toBeInTheDocument();
    expect(screen.getByText(/We sent the confirmation to asha@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/demo booking with sample hotel data/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View booking' })).toHaveAttribute('href', '/my-trips/b1');
    expect(screen.getByRole('link', { name: 'Payment history' })).toHaveAttribute('href', '/account/payments');
  });

  it('a payment that could not be confirmed is refunded, and the customer is told so', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({
      status: 'REFUND_PENDING', paymentStatus: 'REFUND_PENDING', canPay: false,
      failureMessage: 'The hotel could not confirm your rooms. Your payment is being refunded in full.',
    }));
    open();

    expect(await screen.findByText('We could not confirm your booking')).toBeInTheDocument();
    expect(screen.getByText(/being refunded in full/)).toBeInTheDocument();
  });

  it('after a failed payment the room is still held: try again', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ paymentStatus: 'PAYMENT_FAILED' }));
    open();

    expect(await screen.findByText('Payment failed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/my-trips/b1/pay');
  });

  it('a payment that is not confirmed yet waits and offers payment', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture());
    open();

    expect(await screen.findByText('We have not confirmed your payment yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to payment' })).toBeInTheDocument();
  });

  it('shows why a booking ended without a stay', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ status: 'EXPIRED', canPay: false, failureReason: 'PAYMENT_TIMEOUT', failureMessage: null }));
    open();

    expect(await screen.findByText('This booking was not completed')).toBeInTheDocument();
    expect(screen.getByText(/The time to pay ran out/)).toBeInTheDocument();
  });
});

describe('PaymentHistoryPage', () => {
  const summary = (overrides: Partial<PaymentSummary> = {}): PaymentSummary => ({
    id: 'p1aaaaaa-0000-0000-0000-000000000000', bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', description: 'Sea Breeze Resort · 2 nights · 1 room',
    provider: 'DEMO', amount: 2625, refundedAmount: 0, currency: 'INR', status: 'SUCCESS', method: 'demo', failureMessage: null,
    createdAt: '2099-03-01T10:01:00Z', verifiedAt: '2099-03-01T10:01:02Z', invoiceNumber: 'INV/2099-00/000001', bookingType: 'HOTEL', ...overrides,
  });
  const FIGURES = { total: 5, successful: 3, failed: 1, pending: 1, paidAmount: 7875, refundedAmount: 1000, currency: 'INR' };
  const open = (path = '/account/payments') => renderRoutes([
    { path: '/account/payments', element: <PaymentHistoryPage /> },
    { path: '/my-trips/:bookingId', element: <p>booking page</p> },
  ], { path: path, auth: auth() });
  const pageOf = (content: PaymentSummary[], overrides = {}) => ({ content, page: 0, size: 10, totalElements: content.length, totalPages: 1, ...overrides });

  beforeEach(() => {
    vi.mocked(paymentApi.historySummary).mockResolvedValue(FIGURES);
  });

  it('shows the totals from the server and lists payments in a table with status, refunds and booking type', async () => {
    vi.mocked(paymentApi.history).mockResolvedValue(pageOf([
      summary(),
      summary({ id: 'p2bbbbbb-0000-0000-0000-000000000000', status: 'PARTIALLY_REFUNDED', refundedAmount: 1000, invoiceNumber: null, bookingReference: 'HT-BBBB2222' }),
      summary({ id: 'p3cccccc-0000-0000-0000-000000000000', status: 'FAILED', failureMessage: 'The demo payment was declined (Fail button).', invoiceNumber: null,
        bookingReference: 'FL-CCCC3333', bookingType: 'FLIGHT' }),
    ]));
    open();

    const figures = await screen.findByLabelText('Payment figures');
    const card = (label: string) => within(figures).getByText(label).closest('li')!;
    await waitFor(() => expect(card('Total paid')).toHaveTextContent('₹7,875'));
    expect(card('Successful payments')).toHaveTextContent('3');
    expect(card('Pending payments')).toHaveTextContent('1');
    expect(card('Failed payments')).toHaveTextContent('1');
    expect(card('Refunded')).toHaveTextContent('₹1,000');

    const table = await screen.findByRole('table', { name: 'Payments' });
    expect(within(table).getByText('Paid')).toBeInTheDocument();
    expect(within(table).getByText('Partly refunded')).toBeInTheDocument();
    expect(within(table).getByText('Failed')).toBeInTheDocument();
    expect(within(table).getByText('Refunded ₹1,000.00')).toBeInTheDocument();
    expect(within(table).getByText('The demo payment was declined (Fail button).')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'HT-7K3M9Q2X' })).toHaveAttribute('href', '/my-trips/b1');
    expect(within(table).getAllByText('Hotel').length).toBeGreaterThan(0);
    expect(within(table).getByText('Flight')).toBeInTheDocument();
    expect(within(table).getByText('p1aaaaaa')).toBeInTheDocument();
  });

  it('has a friendly empty state', async () => {
    vi.mocked(paymentApi.history).mockResolvedValue(pageOf([], { totalPages: 0 }));
    open();

    expect(await screen.findByText('No payments yet')).toBeInTheDocument();
  });

  it('pages through long histories', async () => {
    vi.mocked(paymentApi.history).mockImplementation(async (page) => ({
      content: [summary({ id: `p${page}` })], page, size: 1, totalElements: 2, totalPages: 2,
    }));
    const { user } = open();
    await screen.findByText('Page 1 of 2');

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
    expect(paymentApi.history).toHaveBeenLastCalledWith(1, 10);
  });

  it('searches, filters by status, type and dates, and sorts, all through the URL and the server', async () => {
    vi.mocked(paymentApi.history).mockResolvedValue(pageOf([summary()]));
    const { user, router } = open();
    await screen.findByRole('table', { name: 'Payments' });

    await user.type(screen.getByRole('searchbox', { name: 'Search my payments' }), 'HT-7K3M9Q2X');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Failed');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Booking type' }), 'Hotels');
    await user.type(screen.getByLabelText('From'), '2099-03-01');

    await waitFor(() => expect(paymentApi.history).toHaveBeenLastCalledWith(0, 10,
      expect.objectContaining({ q: 'HT-7K3M9Q2X', status: 'FAILED', bookingType: 'HOTEL', from: '2099-03-01' })));
    expect(currentLocation(router)).toContain('q=HT-7K3M9Q2X');
    expect(currentLocation(router)).toContain('status=FAILED');
    // The figures above follow the same filters.
    await waitFor(() => expect(paymentApi.historySummary).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED', bookingType: 'HOTEL' })));

    await user.click(screen.getByRole('button', { name: /Amount/ }));
    await waitFor(() => expect(paymentApi.history).toHaveBeenLastCalledWith(0, 10, expect.objectContaining({ sort: 'amount,desc' })));
    expect(currentLocation(router)).toContain('sort=amount%2Cdesc');

    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
    await waitFor(() => expect(currentLocation(router)).toBe('/account/payments'));
  });

  it('opens a payment with its refunds and the receipt and invoice buttons', async () => {
    const full = summary({ status: 'PARTIALLY_REFUNDED', refundedAmount: 1000 });
    vi.mocked(paymentApi.history).mockResolvedValue(pageOf([full]));
    vi.mocked(paymentApi.get).mockResolvedValue({
      ...full,
      refunds: [{ id: 'rf1', amount: 1000, status: 'PROCESSED', reason: 'CANCELLATION', providerRefundId: 'rfnd_1', failureReason: null,
        createdAt: '2099-03-02T10:00:00Z', updatedAt: '2099-03-02T10:05:00Z' }],
    });
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Details of payment p1aaaaaa' }));

    const dialog = await screen.findByRole('dialog', { name: 'Payment details' });
    expect(await within(dialog).findByRole('list', { name: undefined, hidden: false })).toBeInTheDocument();
    expect(within(dialog).getByText('INV/2099-00/000001')).toBeInTheDocument();
    expect(within(dialog).getByText('Refunds')).toBeInTheDocument();
    expect(within(dialog).getByText('Refunded', { selector: 'span' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Download receipt HT-7K3M9Q2X' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Download invoice INV/2099-00/000001' })).toBeInTheDocument();
    expect(paymentApi.get).toHaveBeenCalledWith('p1aaaaaa-0000-0000-0000-000000000000');
  });

  it('tells a failed payment has no receipt, and shows why it failed', async () => {
    const failed = summary({ status: 'FAILED', invoiceNumber: null, failureMessage: 'Card declined' });
    vi.mocked(paymentApi.history).mockResolvedValue(pageOf([failed]));
    vi.mocked(paymentApi.get).mockResolvedValue({ ...failed, refunds: [] });
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: /Details of payment/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Payment details' });
    expect(await within(dialog).findByText('No receipt or invoice: no money was taken for this payment.')).toBeInTheDocument();
    expect(within(dialog).getByText('Card declined')).toBeInTheDocument();
  });

  it('shows the error with a retry when the list cannot be loaded', async () => {
    vi.mocked(paymentApi.history).mockRejectedValue(new ApiError(500, 'HTTP_500', 'Something went wrong on our side. Please try again later.'));
    open();

    expect(await screen.findByText('Something went wrong on our side. Please try again later.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('exports the payments on screen as CSV: amounts, refunds, method and status, no provider ids', async () => {
    const files = stubFileSaving();
    vi.mocked(paymentApi.history).mockResolvedValue(pageOf([
      summary({ createdAt: '2099-03-01T10:01:00', verifiedAt: '2099-03-01T10:01:30' }),
      summary({ id: 'p3cccccc-0000-0000-0000-000000000000', status: 'FAILED', failureMessage: 'Card declined', invoiceNumber: null, method: 'card',
        provider: 'RAZORPAY', bookingReference: 'FL-CCCC3333', bookingType: 'FLIGHT', description: 'Mumbai to Delhi', amount: 9800.5,
        createdAt: '2099-03-02T09:30:00', verifiedAt: null }),
    ]));
    const { user } = open();
    await screen.findByRole('table', { name: 'Payments' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export payment history' });
    expect(within(panel).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]!.fileName).toMatch(/^payment-history-\d{4}-\d{2}-\d{2}\.csv$/);
    expect((await files.blobs[0]!.text()).split('\r\n')).toEqual([
      '"Transaction","Booking reference","Description","Type","Amount","Refunded","Currency","Method","Date","Confirmed at","Status","Why it failed","Invoice number"',
      '"p1aaaaaa","HT-7K3M9Q2X","Sea Breeze Resort · 2 nights · 1 room","Hotel",2625.00,0.00,"INR","Demo (demo payment)",2099-03-01 10:01,2099-03-01 10:01,"Paid",,"INV/2099-00/000001"',
      '"p3cccccc","FL-CCCC3333","Mumbai to Delhi","Flight",9800.50,0.00,"INR","Card",2099-03-02 09:30,,"Failed","Card declined",',
      '',
    ]);
  });

  it('exports every matching payment through the same call, with the search, filters and sort', async () => {
    const files = stubFileSaving();
    const all = Array.from({ length: 25 }, (_, index) => summary({ id: `p${String(index).padStart(7, '0')}-0000-0000-0000-000000000000` }));
    vi.mocked(paymentApi.history).mockImplementation(async (pageNo, size = 10) => ({
      content: all.slice(pageNo * size, pageNo * size + size), page: pageNo, size, totalElements: all.length, totalPages: Math.ceil(all.length / size),
    }));
    const { user } = open('/account/payments?status=SUCCESS&type=HOTEL&sort=amount%2Cdesc');
    await screen.findByText('Page 1 of 3');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^Excel/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(paymentApi.history).toHaveBeenLastCalledWith(0, 100, expect.objectContaining({ status: 'SUCCESS', bookingType: 'HOTEL', sort: 'amount,desc' }));
    expect(files.saved[0]!.fileName).toMatch(/^payment-history-.*\.xlsx$/);
    const workbook = unzipSync(new Uint8Array(await files.blobs[0]!.arrayBuffer()));
    expect(strFromU8(workbook['xl/worksheets/sheet1.xml']!)).toContain('<autoFilter ref="A1:M26"/>');
    const about = strFromU8(workbook['xl/worksheets/sheet2.xml']!);
    for (const text of ['Payment history', 'Asha Rao', 'Paid', 'Hotels', 'Amount, highest first', 'All 25 rows matching the filters']) {
      expect(about).toContain(text);
    }
  });
});
