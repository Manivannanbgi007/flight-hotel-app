import type { AxiosResponse } from 'axios';

import { apiClient } from '@/lib/api/client';
import { stubFileSaving } from '@/test/downloads';
import { documentApi } from './documentApi';
import { downloadDocument, findDocument } from './documentDownload';
import type { BookingDocument } from './types';

const doc = (overrides: Partial<BookingDocument> = {}): BookingDocument => ({
  id: 'd1', bookingId: 'b1', type: 'BOOKING_CONFIRMATION', referenceId: 'b1', title: 'Hotel voucher', fileName: 'HT-7K3M9Q2X-confirmation.pdf',
  sizeBytes: 84_213, createdAt: '2099-03-01T10:02:05Z', ...overrides,
});
const pdf = () => new Blob(['%PDF-1.7'], { type: 'application/pdf' });

describe('documentApi.download', () => {
  it('fetches the PDF as a blob with the token-carrying client and takes the name from Content-Disposition', async () => {
    const blob = pdf();
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: blob, headers: { 'content-disposition': 'attachment; filename="HT-7K3M9Q2X-confirmation.pdf"' },
    } as unknown as AxiosResponse);

    const file = await documentApi.download('d 1');

    expect(get).toHaveBeenCalledWith('/documents/d%201/download', expect.objectContaining({
      responseType: 'blob', headers: { Accept: 'application/pdf, application/problem+json' },
    }));
    expect(file).toEqual({ blob, fileName: 'HT-7K3M9Q2X-confirmation.pdf' });
  });

  it('has no name when the header is missing', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: pdf(), headers: {} } as unknown as AxiosResponse);

    expect((await documentApi.download('d1')).fileName).toBeNull();
  });
});

describe('downloadDocument', () => {
  it('saves the blob under the server\'s file name', async () => {
    const files = stubFileSaving();
    const blob = pdf();
    vi.spyOn(documentApi, 'download').mockResolvedValue({ blob, fileName: 'HT-7K3M9Q2X-e-ticket.pdf' });

    await expect(downloadDocument(doc())).resolves.toBe('HT-7K3M9Q2X-e-ticket.pdf');

    expect(files.blobs).toEqual([blob]);
    expect(files.saved).toEqual([{ href: 'blob:http://localhost/file-1', fileName: 'HT-7K3M9Q2X-e-ticket.pdf' }]);
  });

  it('uses the listed file name when the server sent none', async () => {
    const files = stubFileSaving();
    vi.spyOn(documentApi, 'download').mockResolvedValue({ blob: pdf(), fileName: null });

    await downloadDocument(doc({ fileName: 'listed.pdf' }));

    expect(files.saved[0]?.fileName).toBe('listed.pdf');
  });
});

describe('findDocument', () => {
  const receipts = [
    doc({ id: 'r1', type: 'PAYMENT_RECEIPT', createdAt: '2099-03-01T10:00:00Z' }),
    doc({ id: 'c1', type: 'BOOKING_CONFIRMATION' }),
    doc({ id: 'r2', type: 'PAYMENT_RECEIPT', createdAt: '2099-03-02T10:00:00Z' }),
  ];

  it('takes the newest document of the type (the list is oldest first)', () => {
    expect(findDocument(receipts, 'PAYMENT_RECEIPT')?.id).toBe('r2');
  });

  it('takes the preferred one when there is one', () => {
    expect(findDocument(receipts, 'PAYMENT_RECEIPT', (d) => d.createdAt.startsWith('2099-03-01'))?.id).toBe('r1');
    expect(findDocument(receipts, 'PAYMENT_RECEIPT', () => false)?.id).toBe('r2');
  });

  it('returns null when there is none', () => {
    expect(findDocument(receipts, 'INVOICE')).toBeNull();
  });
});
