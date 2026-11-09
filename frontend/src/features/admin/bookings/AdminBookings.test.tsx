import { screen, waitFor, within } from '@testing-library/react';

import { bookingApi } from '@/features/bookings/bookingApi';
import { bookingFixture, cancellationQuoteFixture, refundFixture } from '@/features/bookings/testData';
import type { BookingDetails } from '@/features/bookings/types';
import { documentApi } from '@/features/documents/documentApi';
import { paymentApi } from '@/features/payments/paymentApi';
import { supportApi } from '@/features/support/supportApi';
import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation } from '@/test/renderRoutes';
import { adminWithout, pageOf, renderAdmin } from '../testUtils';
import { adminBookingApi, type AdminBookingRow } from './adminBookingApi';
import { AdminBookingPage } from './AdminBookingPage';
import { AdminBookingsPage } from './AdminBookingsPage';
import { refundableAmount } from './goodwill';

vi.mock('./adminBookingApi', () => ({ adminBookingApi: { list: vi.fn(), goodwillRefund: vi.fn() } }));
vi.mock('@/features/bookings/bookingApi', () => ({
  bookingApi: { details: vi.fn(), timeline: vi.fn(), cancellationQuote: vi.fn(), cancel: vi.fn() },
}));
vi.mock('@/features/payments/paymentApi', () => ({ paymentApi: { forBooking: vi.fn(), invoiceForBooking: vi.fn() } }));
vi.mock('@/features/support/supportApi', () => ({ supportApi: { escalate: vi.fn(), resolve: vi.fn(), retryRefund: vi.fn() } }));
vi.mock('@/features/documents/documentApi', () => ({ documentApi: { list: vi.fn(), download: vi.fn() } }));

const row = (overrides: Partial<AdminBookingRow> = {}): AdminBookingRow => ({
  id: 'b1', reference: 'HT-7K3M9Q2X', type: 'HOTEL', status: 'CONFIRMED', paymentStatus: 'PAID', title: 'Sea Breeze Resort',
  destination: 'Goa', startDate: '2099-03-10', endDate: '2099-03-12', totalAmount: 2625, refundedAmount: 0, currency: 'INR',
  createdAt: '2099-03-01T10:00:00Z', userId: 'u1', contactEmail: 'asha@example.com', leadName: 'Asha Rao', attentionReason: null,
  attentionSince: null, demo: true, ...overrides,
});

const confirmed = (overrides: Partial<BookingDetails> = {}) => bookingFixture({
  status: 'CONFIRMED', paymentStatus: 'PAID', canPay: false, canCancel: true, ...overrides,
});

const routes = [
  { path: '/admin/bookings', element: <AdminBookingsPage /> },
  { path: '/admin/bookings/:bookingId', element: <AdminBookingPage /> },
];

beforeEach(() => {
  vi.mocked(adminBookingApi.list).mockResolvedValue(pageOf([]));
  vi.mocked(bookingApi.details).mockResolvedValue(confirmed());
  vi.mocked(bookingApi.timeline).mockResolvedValue([
    { fromStatus: 'SUPPLIER_PENDING', status: 'CONFIRMED', reason: 'Hotel confirmed', at: '2099-03-01T10:02:00Z' },
  ]);
  vi.mocked(bookingApi.cancellationQuote).mockResolvedValue(cancellationQuoteFixture());
  vi.mocked(paymentApi.forBooking).mockResolvedValue([]);
  vi.mocked(paymentApi.invoiceForBooking).mockRejectedValue(new ApiError(404, 'INVOICE_NOT_FOUND', 'Not found'));
  vi.mocked(documentApi.list).mockResolvedValue([]);
});

describe('AdminBookingsPage', () => {
  const lastFilters = () => vi.mocked(adminBookingApi.list).mock.lastCall?.[0];

  it('lists bookings with customer, status, payment, refunds and attention, and opens one', async () => {
    vi.mocked(adminBookingApi.list).mockResolvedValue(pageOf([
      row({ refundedAmount: 1968.75, status: 'REFUNDED', paymentStatus: 'PARTIALLY_REFUNDED', attentionReason: 'REFUND_DIFFERS' }),
      row({ id: 'b2', reference: 'FL-AB12CD34', type: 'FLIGHT', title: 'Delhi to Mumbai', leadName: null, contactEmail: 'ravi@example.com' }),
    ]));
    const { user, router } = renderAdmin(routes, '/admin/bookings');

    const table = await screen.findByRole('table', { name: 'Bookings' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('Asha Rao');
    expect(first).toHaveTextContent('₹2,625.00refunded ₹1,968.75');
    expect(within(first!).getByText('Airline refund differs from the quote')).toBeInTheDocument();
    expect(within(first!).getAllByText('Partly refunded')).toHaveLength(2);
    expect(within(second!).getByText('ravi@example.com')).toBeInTheDocument();

    await user.click(within(first!).getByRole('link', { name: 'HT-7K3M9Q2X' }));
    expect(currentLocation(router)).toBe('/admin/bookings/b1');
  });

  it('filters by search, status, type, creation dates and attention, and sorts by amount', async () => {
    vi.mocked(adminBookingApi.list).mockResolvedValue(pageOf([row()]));
    const { user, router } = renderAdmin(routes, '/admin/bookings');
    await screen.findByRole('table', { name: 'Bookings' });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Confirmed');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'Hotels');
    await user.type(screen.getByLabelText('Booked from'), '2099-03-01');
    await user.type(screen.getByLabelText('Booked until'), '2099-03-31');
    await user.click(screen.getByRole('checkbox', { name: 'Needs attention only' }));

    await waitFor(() => expect(lastFilters()).toEqual({
      q: 'asha@example.com', status: 'CONFIRMED', type: 'HOTEL', from: '2099-03-01', to: '2099-03-31', attention: true, page: 0, sort: undefined,
    }));
    await user.click(screen.getByRole('button', { name: /Amount/ }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ sort: 'totalAmount,desc' }));
    expect(currentLocation(router)).toContain('sort=totalAmount%2Cdesc');
  });

  it('exports the page on screen, and every matching booking with the same filters and sort', async () => {
    const files = stubFileSaving();
    vi.mocked(adminBookingApi.list).mockImplementation(async (filters) =>
      pageOf([row({ id: `b${filters.page}`, attentionReason: filters.page === 0 ? 'REFUND_DIFFERS' : null })],
        { page: filters.page, totalElements: 2, totalPages: 2 }));
    const { user } = renderAdmin(routes, '/admin/bookings?status=CONFIRMED&type=HOTEL&attention=true&sort=totalAmount,desc');
    await screen.findByRole('table', { name: 'Bookings' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.saved).toHaveLength(1));
    const lines = (await files.blobs[0]!.text()).trim().split('\r\n');
    expect(lines[0]).toBe('"Reference","Type","Demo","Needs attention","Customer","E-mail","Trip","Destination","Travel from",'
      + '"Travel until","Status","Payment","Amount","Refunded","Currency","Booked"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"HT-7K3M9Q2X","Hotel","Yes","Airline refund differs from the quote","Asha Rao","asha@example.com",'
      + '"Sea Breeze Resort","Goa",2099-03-10,2099-03-12,"Confirmed","Paid",2625.00,0.00,"INR",');

    vi.mocked(adminBookingApi.list).mockClear();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.saved).toHaveLength(2));
    expect(vi.mocked(adminBookingApi.list).mock.calls).toEqual([0, 1].map((page) => [
      { q: '', status: 'CONFIRMED', type: 'HOTEL', from: '', to: '', attention: true, page, sort: 'totalAmount,desc' }, 100]));
    expect((await files.blobs[1]!.text()).trim().split('\r\n')).toHaveLength(3);
  });

  it('pages through the results', async () => {
    vi.mocked(adminBookingApi.list).mockImplementation(async (filters) => pageOf([row()], { page: filters.page, totalElements: 45, totalPages: 3 }));
    const { user } = renderAdmin(routes, '/admin/bookings');

    await user.click(await screen.findByRole('button', { name: 'Next' }));

    await waitFor(() => expect(lastFilters()).toMatchObject({ page: 1 }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('changes the rows per page, starting again on the first page (kept in the URL)', async () => {
    const all = { q: '', status: '', type: '', from: '', to: '', attention: false, sort: undefined };
    vi.mocked(adminBookingApi.list).mockImplementation(async (filters, size = 25) =>
      pageOf([row()], { page: filters.page, size, totalElements: 120, totalPages: Math.ceil(120 / size) }));
    const { user, router } = renderAdmin(routes, '/admin/bookings?page=2');

    expect(await screen.findByText('Page 3 of 5')).toBeInTheDocument();
    expect(adminBookingApi.list).toHaveBeenLastCalledWith({ ...all, page: 2 }, 25);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '50');

    await waitFor(() => expect(adminBookingApi.list).toHaveBeenLastCalledWith({ ...all, page: 0 }, 50));
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('50');
    expect(currentLocation(router)).toBe('/admin/bookings?size=50');
  });

  it('shows the reason and support reference when the search fails', async () => {
    vi.mocked(adminBookingApi.list).mockRejectedValue(new ApiError(400, 'INVALID_RANGE', 'The end date is before the start date.', [], 'corr-5'));
    renderAdmin(routes, '/admin/bookings');

    expect(await screen.findByText('The end date is before the start date.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-5')).toBeInTheDocument();
  });
});

describe('AdminBookingPage', () => {
  it('shows the booking with the admin actions, documents and timeline', async () => {
    vi.mocked(documentApi.list).mockResolvedValue([{ id: 'd1', bookingId: 'b1', type: 'BOOKING_CONFIRMATION', referenceId: 'b1',
      title: 'Hotel voucher', fileName: 'v.pdf', sizeBytes: 2048, createdAt: '2099-03-01T10:03:00Z' }]);
    renderAdmin(routes, '/admin/bookings/b1');

    expect(await screen.findByRole('heading', { name: 'HT-7K3M9Q2X' })).toBeInTheDocument();
    const actions = screen.getByRole('region', { name: 'Actions' });
    expect(within(actions).getByRole('button', { name: 'Cancel on behalf' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Goodwill refund' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Escalate' })).toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Mark resolved' })).not.toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Documents of this booking' })).toHaveTextContent('Hotel voucher');
    expect(await screen.findByRole('list', { name: 'Booking timeline' })).toHaveTextContent('Hotel confirmed');
  });

  it('hides the actions whose permission is missing', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(confirmed({
      status: 'REFUND_PENDING', paymentStatus: 'REFUND_PENDING', canCancel: false, refunds: [refundFixture({ status: 'FAILED' })],
      attention: { reason: 'REFUND_FAILED', note: null, since: '2099-03-02T11:00:00Z' },
    }));
    renderAdmin(routes, '/admin/bookings/b1', adminWithout('REFUND_MANAGE', 'BOOKING_MANAGE_ANY'));

    expect(await screen.findByRole('heading', { name: 'HT-7K3M9Q2X' })).toBeInTheDocument();
    expect(screen.getByText('Needs attention: Refund failed')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('cancels on behalf with the fee waived', async () => {
    vi.mocked(bookingApi.cancel).mockResolvedValue({
      id: 'c1', status: 'PENDING', initiatedBy: 'ADMIN', reason: 'Duplicate booking', feeWaived: true, currency: 'INR', cancellationFee: 0,
      refundAmount: 2625, requestedAt: '2099-03-02T10:00:00Z', completedAt: null, supplierReference: null, failureReason: null, failureMessage: null,
    });
    vi.mocked(bookingApi.cancellationQuote).mockImplementation(async (_id, waive) => cancellationQuoteFixture(
      waive ? { cancellationFee: 0, refundAmount: 2625, feeWaived: true } : {}));
    const { user } = renderAdmin(routes, '/admin/bookings/b1');

    await user.click(await screen.findByRole('button', { name: 'Cancel on behalf' }));
    await user.click(await screen.findByRole('checkbox', { name: /Waive the cancellation fee/ }));
    await waitFor(() => expect(bookingApi.cancellationQuote).toHaveBeenCalledWith('b1', true));
    await user.click(await screen.findByRole('radio', { name: 'Duplicate booking' }));
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel for the customer' }));

    await waitFor(() => expect(bookingApi.cancel).toHaveBeenCalledWith('b1',
      { reason: 'Duplicate booking', expectedRefundAmount: 2625, waiveFee: true }, expect.any(String)));
    expect(await screen.findByText('Cancellation requested for the customer.')).toBeInTheDocument();
  });

  it('gives a goodwill refund after checking the amount and confirming, with one key per submission', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(confirmed({ refundedAmount: 625 }));
    vi.mocked(adminBookingApi.goodwillRefund)
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.'))
      .mockResolvedValue(refundFixture({ id: 'r9', amount: 500, reason: 'GOODWILL' as never }));
    const { user } = renderAdmin(routes, '/admin/bookings/b1');

    await user.click(await screen.findByRole('button', { name: 'Goodwill refund' }));
    expect(screen.getByText(/At most ₹2,000.00 can still be refunded/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter the amount')).toBeInTheDocument();
    expect(screen.getByText('Write the reason (at least 5 characters)')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Amount (INR)'), '2500');
    await user.type(screen.getByLabelText('Reason'), 'Room was not cleaned');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('At most ₹2,000.00 can be refunded')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Amount (INR)'));
    await user.type(screen.getByLabelText('Amount (INR)'), '500');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const dialog = screen.getByRole('dialog', { name: 'Refund ₹500.00?' });
    await user.click(within(dialog).getByRole('button', { name: 'Refund now' }));
    expect(await screen.findByText('Cannot reach the server. Check your connection and try again.')).toBeInTheDocument();

    // The same submission again (after a network error) keeps its key, so the money cannot go out twice.
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Refund now' }));
    await waitFor(() => expect(adminBookingApi.goodwillRefund).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(adminBookingApi.goodwillRefund).mock.calls;
    expect(first).toEqual(['b1', { amount: 500, reason: 'Room was not cleaned' }, expect.any(String)]);
    expect(second![2]).toBe(first![2]);
    expect(await screen.findByText('Goodwill refund of ₹500.00 requested.')).toBeInTheDocument();

    // A new submission gets a new key.
    await user.click(screen.getByRole('button', { name: 'Goodwill refund' }));
    await user.type(screen.getByLabelText('Amount (INR)'), '500');
    await user.type(screen.getByLabelText('Reason'), 'Room was not cleaned');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Refund now' }));
    await waitFor(() => expect(adminBookingApi.goodwillRefund).toHaveBeenCalledTimes(3));
    expect(vi.mocked(adminBookingApi.goodwillRefund).mock.calls[2]![2]).not.toBe(first![2]);
  });

  it('shows how much is still refundable when the server says the amount is too large', async () => {
    vi.mocked(adminBookingApi.goodwillRefund).mockRejectedValue(
      new ApiError(422, 'REFUND_TOO_LARGE', 'The refund is larger than what can still be refunded.', [], 'corr-8', { refundable: 300 }));
    const { user } = renderAdmin(routes, '/admin/bookings/b1');

    await user.click(await screen.findByRole('button', { name: 'Goodwill refund' }));
    await user.type(screen.getByLabelText('Amount (INR)'), '1000');
    await user.type(screen.getByLabelText('Reason'), 'Late check-in');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Refund now' }));

    expect(await screen.findByText('At most ₹300.00 can be refunded now.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-8')).toBeInTheDocument();
  });

  it('retries a failed refund and resolves the attention flag', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(confirmed({
      status: 'REFUND_PENDING', paymentStatus: 'REFUND_PENDING', canCancel: false, refundedAmount: 0,
      refunds: [refundFixture({ status: 'FAILED' })], attention: { reason: 'REFUND_FAILED', note: null, since: '2099-03-02T11:00:00Z' },
    }));
    vi.mocked(supportApi.retryRefund).mockResolvedValue(refundFixture({ id: 'r2' }));
    vi.mocked(supportApi.resolve).mockResolvedValue(undefined);
    const { user } = renderAdmin(routes, '/admin/bookings/b1');

    await user.click(await screen.findByRole('button', { name: 'Retry refund of ₹1,968.75' }));
    await waitFor(() => expect(supportApi.retryRefund).toHaveBeenCalledWith('b1'));
    expect(await screen.findByText('Refund requested again.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mark resolved' }));
    await user.type(screen.getByLabelText(/Note/), 'Bank confirmed');
    await user.click(screen.getByRole('button', { name: 'Save and resolve' }));
    await waitFor(() => expect(supportApi.resolve).toHaveBeenCalledWith('b1', 'Bank confirmed'));
  });

  it('says when the booking does not exist', async () => {
    vi.mocked(bookingApi.details).mockRejectedValue(new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found.', [], 'corr-4'));
    renderAdmin(routes, '/admin/bookings/nope');

    expect(await screen.findByRole('heading', { name: 'Booking not found' })).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All bookings' })).toHaveAttribute('href', '/admin/bookings');
  });
});

describe('refundableAmount', () => {
  it('is what was paid minus what came back and what is on its way', () => {
    expect(refundableAmount(confirmed({ refundedAmount: 625, refunds: [refundFixture({ amount: 1000, status: 'REQUESTED' })] }))).toBe(1000);
    expect(refundableAmount(confirmed({ paymentStatus: 'UNPAID' }))).toBe(0);
    expect(refundableAmount(confirmed({ refundedAmount: 2625, paymentStatus: 'REFUNDED' }))).toBe(0);
  });
});
