import { screen, waitFor, within } from '@testing-library/react';

import { bookingFixture } from '@/features/bookings/testData';
import type { BookingDetails } from '@/features/bookings/types';
import { ApiError } from '@/lib/api/apiError';
import { applyInvalidation } from '@/lib/realtime/invalidationRules';
import { stubFileSaving } from '@/test/downloads';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { documentApi } from './documentApi';
import { DocumentsCard } from './DocumentsCard';
import type { BookingDocument } from './types';

vi.mock('./documentApi', () => ({ documentApi: { list: vi.fn(), download: vi.fn() } }));

const doc = (overrides: Partial<BookingDocument> = {}): BookingDocument => ({
  id: 'd1', bookingId: 'b1', type: 'BOOKING_CONFIRMATION', referenceId: 'b1', title: 'Hotel voucher', fileName: 'HT-7K3M9Q2X-confirmation.pdf',
  sizeBytes: 84_213, createdAt: '2099-03-01T10:02:05Z', ...overrides,
});
const pdf = () => new Blob(['%PDF-1.7'], { type: 'application/pdf' });

describe('DocumentsCard', () => {
  const confirmed = (overrides: Partial<BookingDetails> = {}) =>
    bookingFixture({ status: 'CONFIRMED', paymentStatus: 'PAID', canPay: false, confirmedAt: '2099-03-01T10:02:00Z', ...overrides });
  const open = (booking: BookingDetails) =>
    renderRoutes(<DocumentsCard booking={booking} />, { auth: fakeAuth({ user: customer }) });

  it('lists the booking\'s documents and downloads one with the user\'s token under the server\'s file name', async () => {
    const files = stubFileSaving();
    vi.mocked(documentApi.list).mockResolvedValue([
      doc(),
      doc({ id: 'd2', type: 'PAYMENT_RECEIPT', title: 'Payment receipt', fileName: 'HT-7K3M9Q2X-receipt.pdf', sizeBytes: 2048 }),
    ]);
    vi.mocked(documentApi.download).mockResolvedValue({ blob: pdf(), fileName: 'HT-7K3M9Q2X-confirmation.pdf' });
    const { user } = open(confirmed());

    const list = await screen.findByRole('list', { name: 'Documents of this booking' });
    expect(within(list).getByText('Hotel voucher')).toBeInTheDocument();
    expect(within(list).getByText(/PDF · 82 KB/)).toBeInTheDocument();
    expect(within(list).getByText(/PDF · 2 KB/)).toBeInTheDocument();
    expect(documentApi.list).toHaveBeenCalledWith('b1');

    await user.click(within(list).getByRole('button', { name: 'Download Hotel voucher' }));

    await waitFor(() => expect(files.saved).toEqual([{ href: 'blob:http://localhost/file-1', fileName: 'HT-7K3M9Q2X-confirmation.pdf' }]));
    expect(documentApi.download).toHaveBeenCalledWith('d1');
  });

  it('says documents appear a few seconds after confirmation while a confirmed booking has none yet', async () => {
    vi.mocked(documentApi.list).mockResolvedValue([]);
    open(confirmed());

    expect(await screen.findByText(/Documents appear a few seconds after confirmation/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
  });

  it('is not shown before anything was paid', () => {
    open(bookingFixture({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' }));

    expect(screen.queryByRole('heading', { name: 'Documents' })).not.toBeInTheDocument();
    expect(documentApi.list).not.toHaveBeenCalled();
  });

  it('shows the documents of a cancelled and refunded booking', async () => {
    vi.mocked(documentApi.list).mockResolvedValue([
      doc(), doc({ id: 'd3', type: 'CANCELLATION_CONFIRMATION', title: 'Cancellation confirmation' }),
      doc({ id: 'd4', type: 'REFUND_RECEIPT', title: '' }),
    ]);
    open(bookingFixture({ status: 'REFUNDED', paymentStatus: 'REFUNDED', canPay: false }));

    const list = await screen.findByRole('list', { name: 'Documents of this booking' });
    expect(within(list).getByText('Cancellation confirmation')).toBeInTheDocument();
    // No title from the server: the type's name.
    expect(within(list).getByText('Refund receipt')).toBeInTheDocument();
  });

  it('hides the card of a refunded booking without documents', async () => {
    vi.mocked(documentApi.list).mockResolvedValue([]);
    const { queryClient } = open(bookingFixture({ status: 'FAILED', paymentStatus: 'REFUNDED', canPay: false }));

    await waitFor(() => expect(queryClient.getQueryState(['documents', 'booking', 'b1'])?.status).toBe('success'));
    expect(screen.queryByRole('heading', { name: 'Documents' })).not.toBeInTheDocument();
  });

  it('shows a document that arrives live (document.created refreshes the list)', async () => {
    vi.mocked(documentApi.list).mockResolvedValueOnce([]).mockResolvedValue([doc()]);
    const { queryClient } = open(confirmed());
    await screen.findByText(/Documents appear a few seconds after confirmation/);

    applyInvalidation(queryClient, { id: 'm1', type: 'document.created', resourceType: 'BOOKING', resourceId: 'b1', data: {}, occurredAt: '2099-03-01T10:02:05Z' });

    expect(await screen.findByRole('button', { name: 'Download Hotel voucher' })).toBeInTheDocument();
  });

  it('shows why a download failed, with the support reference', async () => {
    stubFileSaving();
    vi.mocked(documentApi.list).mockResolvedValue([doc()]);
    vi.mocked(documentApi.download).mockRejectedValue(new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found', [], 'corr-9'));
    const { user } = open(confirmed());

    await user.click(await screen.findByRole('button', { name: 'Download Hotel voucher' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The download did not work');
    expect(alert).toHaveTextContent('Document not found');
    expect(alert).toHaveTextContent('Support reference: corr-9');
  });

  it('offers a retry when the list cannot be loaded', async () => {
    vi.mocked(documentApi.list).mockRejectedValueOnce(new ApiError(503, 'HTTP_503', 'Try later.')).mockResolvedValue([doc()]);
    const { user } = open(confirmed());

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Download Hotel voucher' })).toBeInTheDocument();
  });
});
