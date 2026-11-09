import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation } from '@/test/renderRoutes';
import { adminWithout, pageOf, renderAdmin } from '../testUtils';
import { adminPaymentApi, type AdminPaymentRow, type AdminRefundRow, type PaymentDetails } from './adminPaymentApi';
import { AdminPaymentPage } from './AdminPaymentPage';
import { AdminPaymentsPage } from './AdminPaymentsPage';
import { AdminRefundsPage } from './AdminRefundsPage';

vi.mock('./adminPaymentApi', () => ({ adminPaymentApi: { list: vi.fn(), summary: vi.fn(), get: vi.fn(), refunds: vi.fn() } }));

const payment = (overrides: Partial<AdminPaymentRow> = {}): AdminPaymentRow => ({
  id: 'p1', bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', description: 'Sea Breeze Resort', provider: 'RAZORPAY', amount: 6300,
  refundedAmount: 3150, currency: 'INR', status: 'PARTIALLY_REFUNDED', method: 'upi', failureMessage: null, createdAt: '2026-11-01T10:00:00Z',
  verifiedAt: '2026-11-01T10:01:00Z', invoiceNumber: 'INV/2026-27/000123', userId: 'u1', contactEmail: 'asha@example.com',
  providerPaymentId: 'pay_123', providerOrderId: 'order_123', failureCode: null, bookingType: 'HOTEL', ...overrides,
});

const SUMMARY = { total: 12, successful: 8, failed: 3, pending: 1, collectedAmount: 50400, refundedAmount: 3150, currency: 'INR' };

beforeEach(() => {
  vi.mocked(adminPaymentApi.summary).mockResolvedValue(SUMMARY);
});

const refund = (overrides: Partial<AdminRefundRow> = {}): AdminRefundRow => ({
  id: 'rf1', paymentId: 'p1', bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', amount: 3150, status: 'PROCESSED', reason: 'CANCELLATION',
  providerRefundId: 'rfnd_1', failureReason: null, createdAt: '2026-11-02T10:00:00Z', updatedAt: '2026-11-02T10:05:00Z', ...overrides,
});

const routes = [
  { path: '/admin/payments', element: <AdminPaymentsPage /> },
  { path: '/admin/payments/:paymentId', element: <AdminPaymentPage /> },
  { path: '/admin/refunds', element: <AdminRefundsPage /> },
  { path: '/admin/bookings/:bookingId', element: <p>booking page</p> },
];

describe('AdminPaymentsPage', () => {
  it('lists payments with booking, status, refunds and opens one', async () => {
    vi.mocked(adminPaymentApi.list).mockResolvedValue(pageOf([payment(), payment({ id: 'p2', status: 'FAILED', refundedAmount: 0,
      failureMessage: 'Card declined', provider: 'DEMO', method: null })]));
    const { user, router } = renderAdmin(routes, '/admin/payments');

    const table = await screen.findByRole('table', { name: 'Payments' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('UPIRazorpay');
    expect(first).toHaveTextContent('Partly refunded');
    expect(first).toHaveTextContent('₹6,300.00refunded ₹3,150.00');
    expect(first).toHaveTextContent('asha@example.com');
    expect(first).toHaveTextContent('Hotel');
    expect(first).toHaveTextContent('pay_123');
    expect(second).toHaveTextContent('Card declined');
    expect(within(first!).getByRole('link', { name: 'HT-7K3M9Q2X' })).toHaveAttribute('href', '/admin/bookings/b1');

    await user.click(within(first!).getByRole('link', { name: 'p1…' }));
    expect(currentLocation(router)).toBe('/admin/payments/p1');
  });

  it('exports the page on screen, and every matching payment with the same filters and sort', async () => {
    const files = stubFileSaving();
    vi.mocked(adminPaymentApi.list).mockImplementation(async (filters) =>
      pageOf([payment({ id: `p${filters.page}` })], { page: filters.page, totalElements: 2, totalPages: 2 }));
    const { user } = renderAdmin(routes, '/admin/payments?status=PARTIALLY_REFUNDED&provider=RAZORPAY&sort=amount,asc');
    await screen.findByRole('table', { name: 'Payments' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.saved).toHaveLength(1));
    const lines = (await files.blobs[0]!.text()).trim().split('\r\n');
    expect(lines[0]).toBe('"Payment ID","Booking reference","Customer e-mail","Booking type","Amount","Refunded","Currency",'
      + '"Method","Provider","Transaction ID","Status","Failure","Date"');
    expect(lines).toHaveLength(2);
    // The full payment id (the table shortens it), and no field the table does not show.
    expect(lines[1]).toMatch(/^"p0","HT-7K3M9Q2X","asha@example\.com","Hotel",6300\.00,3150\.00,"INR","UPI","Razorpay","pay_123","Partly refunded",,\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(lines[1]).not.toContain('INV/2026-27/000123');

    vi.mocked(adminPaymentApi.list).mockClear();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.saved).toHaveLength(2));
    expect(vi.mocked(adminPaymentApi.list).mock.calls).toEqual([0, 1].map((page) => [{
      q: '', status: 'PARTIALLY_REFUNDED', provider: 'RAZORPAY', method: '', bookingType: '', from: '', to: '', page, sort: 'amount,asc',
    }, 100]));
    expect((await files.blobs[1]!.text()).trim().split('\r\n')).toHaveLength(3);
  });

  it('shows the figures for the current filters from the server', async () => {
    vi.mocked(adminPaymentApi.list).mockResolvedValue(pageOf([payment()]));
    renderAdmin(routes, '/admin/payments?status=FAILED&bookingType=FLIGHT');

    const figures = await screen.findByLabelText('Payment figures');
    // Each card: its label, then the value twice (the counting-up number and its fixed text for screen readers).
    const card = (label: string) => within(figures).getByText(label).closest('li')!;
    await waitFor(() => expect(card('Total payments')).toHaveTextContent('12'));
    expect(card('Successful payments')).toHaveTextContent('8');
    expect(card('Failed payments')).toHaveTextContent('3');
    expect(card('Pending payments')).toHaveTextContent('1');
    expect(card('Collected revenue')).toHaveTextContent('₹50,400');
    expect(card('Refunded amount')).toHaveTextContent('₹3,150');
    expect(adminPaymentApi.summary).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', bookingType: 'FLIGHT' }));
    expect(adminPaymentApi.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', bookingType: 'FLIGHT' }), 25);
  });

  it('says so when the figures cannot be loaded, and still lists the payments', async () => {
    vi.mocked(adminPaymentApi.summary).mockRejectedValue(new ApiError(502, 'HTTP_502', 'Something went wrong on our side.', [], 'corr-9'));
    vi.mocked(adminPaymentApi.list).mockResolvedValue(pageOf([payment()]));
    renderAdmin(routes, '/admin/payments');

    expect(await screen.findByText('The payment figures could not be loaded')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Payments' })).toBeInTheDocument();
  });

  it('filters by search, status, provider and dates', async () => {
    vi.mocked(adminPaymentApi.list).mockResolvedValue(pageOf([]));
    const { user } = renderAdmin(routes, '/admin/payments');
    await screen.findByText('No payments found');

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'pay_123');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Failed');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'Demo');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Payment method' }), 'UPI');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Booking type' }), 'Flight bookings');
    await user.type(screen.getByLabelText('From'), '2026-11-01');

    await waitFor(() => expect(adminPaymentApi.list).toHaveBeenLastCalledWith(
      { q: 'pay_123', status: 'FAILED', provider: 'DEMO', method: 'upi', bookingType: 'FLIGHT', from: '2026-11-01', to: '', page: 0,
        sort: undefined }, 25));
  });

  it('is closed without PAYMENT_READ_ANY', () => {
    renderAdmin(routes, '/admin/payments', adminWithout('PAYMENT_READ_ANY'));

    expect(screen.getByRole('heading', { name: "You don't have access to this section" })).toBeInTheDocument();
    expect(adminPaymentApi.list).not.toHaveBeenCalled();
  });
});

describe('AdminPaymentPage', () => {
  it('shows the payment, its provider ids and its refunds', async () => {
    const details: PaymentDetails = {
      ...payment(),
      refunds: [
        { id: 'rf1', amount: 3150, status: 'PROCESSED', reason: 'CANCELLATION', providerRefundId: 'rfnd_1', failureReason: null,
          createdAt: '2026-11-02T10:00:00Z', updatedAt: '2026-11-02T10:05:00Z' },
        { id: 'rf2', amount: 100, status: 'FAILED', reason: 'GOODWILL', providerRefundId: null, failureReason: 'Account closed',
          createdAt: '2026-11-03T10:00:00Z', updatedAt: '2026-11-03T10:05:00Z' },
      ],
    };
    vi.mocked(adminPaymentApi.get).mockResolvedValue(details);
    renderAdmin(routes, '/admin/payments/p1');

    expect(await screen.findByRole('heading', { name: 'Payment of ₹6,300.00' })).toBeInTheDocument();
    expect(screen.getByText('pay_123')).toBeInTheDocument();
    expect(screen.getByText('INV/2026-27/000123')).toBeInTheDocument();
    const rows = within(screen.getByRole('table', { name: 'Refunds of this payment' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('CancellationRefunded₹3,150.00');
    expect(rows[2]).toHaveTextContent('GoodwillFailedAccount closed₹100.00');
    expect(adminPaymentApi.get).toHaveBeenCalledWith('p1');
  });

  it('says when the payment does not exist', async () => {
    vi.mocked(adminPaymentApi.get).mockRejectedValue(new ApiError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.'));
    renderAdmin(routes, '/admin/payments/nope');

    expect(await screen.findByRole('heading', { name: 'Payment not found' })).toBeInTheDocument();
  });
});

describe('AdminRefundsPage', () => {
  it('lists refunds with links to the booking and the payment, filtered by status', async () => {
    vi.mocked(adminPaymentApi.refunds).mockResolvedValue(pageOf([refund(), refund({ id: 'rf2', status: 'FAILED', failureReason: 'Bank error' })]));
    const { user } = renderAdmin(routes, '/admin/refunds');

    const table = await screen.findByRole('table', { name: 'Refunds' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('HT-7K3M9Q2XCancellationRefunded₹3,150.00');
    expect(second).toHaveTextContent('FailedBank error');
    expect(within(first!).getByRole('link', { name: 'HT-7K3M9Q2X' })).toHaveAttribute('href', '/admin/bookings/b1');
    expect(within(first!).getByRole('link', { name: 'Payment' })).toHaveAttribute('href', '/admin/payments/p1');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Failed');
    await waitFor(() => expect(adminPaymentApi.refunds).toHaveBeenLastCalledWith({ q: '', status: 'FAILED', from: '', to: '', page: 0 }, 25));
  });

  it('exports the page on screen, and every matching refund with the same filters', async () => {
    const files = stubFileSaving();
    vi.mocked(adminPaymentApi.refunds).mockImplementation(async (filters) =>
      pageOf([refund({ id: `rf${filters.page}` })], { page: filters.page, totalElements: 2, totalPages: 2 }));
    const { user } = renderAdmin(routes, '/admin/refunds?status=PROCESSED');
    await screen.findByRole('table', { name: 'Refunds' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.saved).toHaveLength(1));
    const lines = (await files.blobs[0]!.text()).trim().split('\r\n');
    expect(lines[0]).toBe('"Booking reference","Reason","Status","Failure","Amount (INR)","Requested","Updated"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^"HT-7K3M9Q2X","Cancellation","Refunded",,3150\.00,\d{4}-\d{2}-\d{2} \d{2}:\d{2},\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    vi.mocked(adminPaymentApi.refunds).mockClear();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.saved).toHaveLength(2));
    expect(vi.mocked(adminPaymentApi.refunds).mock.calls).toEqual([0, 1].map((page) =>
      [{ q: '', status: 'PROCESSED', from: '', to: '', page }, 100]));
  });

  it('shows the support reference when loading fails', async () => {
    vi.mocked(adminPaymentApi.refunds).mockRejectedValue(new ApiError(502, 'HTTP_502', 'Something went wrong on our side. Please try again later.', [], 'corr-2'));
    renderAdmin(routes, '/admin/refunds');

    expect(await screen.findByText('Support reference: corr-2')).toBeInTheDocument();
  });
});
