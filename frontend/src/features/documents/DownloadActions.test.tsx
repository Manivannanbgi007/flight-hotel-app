import { screen, waitFor, within } from '@testing-library/react';

import { bookingApi } from '@/features/bookings/bookingApi';
import { MyTripsPage } from '@/features/bookings/MyTripsPage';
import { summaryFixture } from '@/features/bookings/testData';
import { paymentApi } from '@/features/payments/paymentApi';
import { PaymentHistoryPage } from '@/features/payments/PaymentHistoryPage';
import type { PaymentSummary } from '@/features/payments/types';
import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { documentApi } from './documentApi';
import type { BookingDocument } from './types';

vi.mock('./documentApi', () => ({ documentApi: { list: vi.fn(), download: vi.fn() } }));
vi.mock('@/features/bookings/bookingApi', () => ({ bookingApi: { list: vi.fn() } }));
vi.mock('@/features/payments/paymentApi', () => ({ paymentApi: { history: vi.fn(), historySummary: vi.fn(), get: vi.fn() } }));
// Completed stays may be reviewable: My Trips asks which ones (none here).
vi.mock('@/features/reviews/reviewApi', () => ({ reviewApi: { eligible: vi.fn().mockResolvedValue([]) } }));

const auth = () => fakeAuth({ user: customer });
const page = <T,>(content: T[]) => ({ content, page: 0, size: 10, totalElements: content.length, totalPages: 1 });
const doc = (overrides: Partial<BookingDocument>): BookingDocument => ({
  id: 'd1', bookingId: 'b1', type: 'BOOKING_CONFIRMATION', referenceId: 'b1', title: 'Hotel voucher', fileName: 'listed.pdf', sizeBytes: 1000,
  createdAt: '2099-03-01T10:02:05Z', ...overrides,
});
const pdf = () => new Blob(['%PDF-1.7'], { type: 'application/pdf' });

describe('My Trips: Download confirmation', () => {
  const open = () => renderRoutes([{ path: '/my-trips', element: <MyTripsPage /> }], { path: '/my-trips', auth: auth() });

  beforeEach(() => {
    vi.mocked(bookingApi.list).mockResolvedValue(page([
      summaryFixture({ id: 'b1', status: 'CONFIRMED' }),
      summaryFixture({ id: 'b2', reference: 'HT-COMPLETED', status: 'COMPLETED' }),
      summaryFixture({ id: 'b3', reference: 'HT-PENDING1', status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' }),
      summaryFixture({ id: 'b4', reference: 'HT-CANCELLED', status: 'CANCELLED' }),
    ]));
  });

  it('is offered for confirmed and completed trips only', async () => {
    open();

    const list = await screen.findByRole('list', { name: 'Bookings' });
    expect(within(list).getByRole('button', { name: 'Download confirmation HT-7K3M9Q2X' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Download confirmation HT-COMPLETED' })).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Download confirmation HT-PENDING1' })).not.toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Download confirmation HT-CANCELLED' })).not.toBeInTheDocument();
    expect(documentApi.list).not.toHaveBeenCalled();
  });

  it('loads the booking\'s documents on click and downloads the newest confirmation', async () => {
    const files = stubFileSaving();
    vi.mocked(documentApi.list).mockResolvedValue([
      doc({ id: 'receipt', type: 'PAYMENT_RECEIPT' }),
      doc({ id: 'old-confirmation' }),
      doc({ id: 'new-confirmation', createdAt: '2099-03-02T10:00:00Z' }),
    ]);
    vi.mocked(documentApi.download).mockResolvedValue({ blob: pdf(), fileName: 'HT-7K3M9Q2X-confirmation.pdf' });
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Download confirmation HT-7K3M9Q2X' }));

    await waitFor(() => expect(files.saved).toEqual([{ href: 'blob:http://localhost/file-1', fileName: 'HT-7K3M9Q2X-confirmation.pdf' }]));
    expect(documentApi.list).toHaveBeenCalledWith('b1');
    expect(documentApi.download).toHaveBeenCalledWith('new-confirmation');
  });

  it('says so when the confirmation is not ready yet', async () => {
    const files = stubFileSaving();
    vi.mocked(documentApi.list).mockResolvedValue([doc({ type: 'PAYMENT_RECEIPT' })]);
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Download confirmation HT-7K3M9Q2X' }));

    expect(await screen.findByText(/Your confirmation is not ready yet/)).toBeInTheDocument();
    expect(documentApi.download).not.toHaveBeenCalled();
    expect(files.saved).toEqual([]);
  });

  it('shows a failed download with the support reference', async () => {
    vi.mocked(documentApi.list).mockRejectedValue(new ApiError(503, 'HTTP_503', 'Please try again later.', [], 'corr-5'));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Download confirmation HT-7K3M9Q2X' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Please try again later.');
    expect(alert).toHaveTextContent('Support reference: corr-5');
  });
});

describe('Payment history: receipt and invoice', () => {
  const payment = (overrides: Partial<PaymentSummary> = {}): PaymentSummary => ({
    id: 'p1', bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', description: 'Sea Breeze Resort', provider: 'DEMO', amount: 2625,
    refundedAmount: 0, currency: 'INR', status: 'SUCCESS', method: 'demo', failureMessage: null, createdAt: '2099-03-01T10:01:00Z',
    verifiedAt: '2099-03-01T10:01:02Z', invoiceNumber: 'INV/2099-00/000001', ...overrides,
  });
  const open = () => {
    vi.mocked(paymentApi.historySummary).mockResolvedValue({ total: 0, successful: 0, failed: 0, pending: 0, paidAmount: 0, refundedAmount: 0, currency: 'INR' });
    vi.mocked(paymentApi.get).mockImplementation(async (id) => ({ ...payment({ id }), refunds: [] }));
    return renderRoutes([{ path: '/account/payments', element: <PaymentHistoryPage /> }], { path: '/account/payments', auth: auth() });
  };
  /** The receipt and invoice buttons are in the payment's details view. */
  const openDetails = async (user: ReturnType<typeof open>['user'], id: string) => {
    await user.click(await screen.findByRole('button', { name: `Details of payment ${id}` }));
    return screen.findByRole('dialog', { name: 'Payment details' });
  };

  it('offers the receipt of captured payments and the invoice when there is one', async () => {
    const list = [
      payment(),
      payment({ id: 'p2', bookingReference: 'HT-REFUNDED', status: 'REFUNDED', invoiceNumber: null }),
      payment({ id: 'p3', bookingReference: 'HT-FAILED', status: 'FAILED', invoiceNumber: null }),
    ];
    vi.mocked(paymentApi.history).mockResolvedValue(page(list));
    const { user } = open();
    vi.mocked(paymentApi.get).mockImplementation(async (id) => ({ ...list.find((item) => item.id === id)!, refunds: [] }));

    let dialog = await openDetails(user, 'p1');
    expect(await within(dialog).findByRole('button', { name: 'Download receipt HT-7K3M9Q2X' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Download invoice INV/2099-00/000001' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    dialog = await openDetails(user, 'p2');
    expect(await within(dialog).findByRole('button', { name: 'Download receipt HT-REFUNDED' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    dialog = await openDetails(user, 'p3');
    expect(await within(dialog).findByText(/no money was taken/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /HT-FAILED/ })).not.toBeInTheDocument();
  });

  it('downloads the receipt made for this payment and the invoice with this number', async () => {
    const files = stubFileSaving();
    vi.mocked(paymentApi.history).mockResolvedValue(page([payment()]));
    vi.mocked(documentApi.list).mockResolvedValue([
      // Receipts are matched by the payment id (referenceId), the invoice by its number in the file name.
      doc({ id: 'earlier-receipt', type: 'PAYMENT_RECEIPT', referenceId: 'p0', createdAt: '2099-02-20T09:00:00Z' }),
      doc({ id: 'this-receipt', type: 'PAYMENT_RECEIPT', referenceId: 'p1', createdAt: '2099-03-01T10:01:04.250Z' }),
      doc({ id: 'invoice', type: 'INVOICE', referenceId: 'i1', title: 'Tax invoice',
        fileName: 'INV-2099-00-000001-invoice.pdf' }),
      doc({ id: 'later-receipt', type: 'PAYMENT_RECEIPT', referenceId: 'p9', createdAt: '2099-03-05T09:00:00Z' }),
    ]);
    vi.mocked(documentApi.download).mockImplementation(async (id) => ({ blob: pdf(), fileName: `${id}.pdf` }));
    const { user } = open();
    const dialog = await openDetails(user, 'p1');

    await user.click(await within(dialog).findByRole('button', { name: 'Download receipt HT-7K3M9Q2X' }));
    await waitFor(() => expect(files.saved.map((file) => file.fileName)).toEqual(['this-receipt.pdf']));

    await user.click(within(dialog).getByRole('button', { name: 'Download invoice INV/2099-00/000001' }));
    await waitFor(() => expect(files.saved.map((file) => file.fileName)).toEqual(['this-receipt.pdf', 'invoice.pdf']));
    expect(documentApi.list).toHaveBeenCalledWith('b1');
  });

  it('says so when the invoice PDF is not ready yet', async () => {
    vi.mocked(paymentApi.history).mockResolvedValue(page([payment()]));
    vi.mocked(documentApi.list).mockResolvedValue([doc({ type: 'PAYMENT_RECEIPT' })]);
    const { user } = open();
    const dialog = await openDetails(user, 'p1');

    await user.click(await within(dialog).findByRole('button', { name: 'Download invoice INV/2099-00/000001' }));

    expect(await screen.findByText(/The invoice PDF is not ready yet/)).toBeInTheDocument();
    expect(documentApi.download).not.toHaveBeenCalled();
  });
});
