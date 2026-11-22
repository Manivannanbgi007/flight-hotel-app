import { saveFile } from '@/lib/download';
import { documentApi } from './documentApi';

/** How each document type is called on screen when the server's `title` is missing. */
export const documentTypeLabels = {
  BOOKING_CONFIRMATION: 'Booking confirmation',
  E_TICKET: 'E-ticket',
  INVOICE: 'Tax invoice',
  PAYMENT_RECEIPT: 'Payment receipt',
  CANCELLATION_CONFIRMATION: 'Cancellation confirmation',
  REFUND_RECEIPT: 'Refund receipt',
};

/**
 * THE download helper: fetches the PDF with the user's token and saves it under the name from `Content-Disposition`
 * (the list's `fileName` if the header has none). Returns the name it was saved under.
 */
export async function downloadDocument(document) {
  const file = await documentApi.download(document.id);
  const fileName = file.fileName ?? (document.fileName || 'document.pdf');
  saveFile(file.blob, fileName);
  return fileName;
}

/**
 * The document of `type` to download: the first one `prefer` accepts, otherwise the newest (the list is oldest first).
 * Null when the booking has none (yet).
 */
export function findDocument(documents, type, prefer) {
  const ofType = documents.filter((document) => document.type === type);
  return (prefer && ofType.find(prefer)) ?? ofType.at(-1) ?? null;
}

/** Money was captured for the booking, so at least a payment receipt exists (or will in a few seconds). */
export function hasCapturedPayment(paymentStatus) {
  return paymentStatus !== 'UNPAID' && paymentStatus !== 'PAYMENT_FAILED';
}
