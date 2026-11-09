import { apiClient } from '@/lib/api/client';
import { fileNameFromContentDisposition } from '@/lib/download';
import type { BookingDocument, DownloadedFile } from './types';

/**
 * `/api/documents` (API_DOCUMENTATION.md §10b). There are no public file URLs: the PDF is fetched with the bearer token
 * as a Blob and saved from memory.
 */
export const documentApi = {
  /** The booking's documents, oldest first. `404 BOOKING_NOT_FOUND` for someone else's booking. */
  async list(bookingId: string): Promise<BookingDocument[]> {
    const { data } = await apiClient.get<BookingDocument[]>('/documents', { params: { bookingId } });
    return data;
  },

  async download(documentId: string): Promise<DownloadedFile> {
    const response = await apiClient.get<Blob>(`/documents/${encodeURIComponent(documentId)}/download`, {
      responseType: 'blob',
      // The client's default "Accept: application/json" would get 406 from a PDF endpoint; errors stay Problem Details.
      headers: { Accept: 'application/pdf, application/problem+json' },
    });
    const disposition = response.headers['content-disposition'] as string | undefined;
    return { blob: response.data, fileName: fileNameFromContentDisposition(disposition) };
  },
};
