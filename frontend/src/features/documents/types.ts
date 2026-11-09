/** Booking documents (API_DOCUMENTATION.md §10b): PDFs made on the server, downloaded with the user's token. */
export type DocumentType =
  | 'BOOKING_CONFIRMATION'
  | 'E_TICKET'
  | 'INVOICE'
  | 'PAYMENT_RECEIPT'
  | 'CANCELLATION_CONFIRMATION'
  | 'REFUND_RECEIPT';

export interface BookingDocument {
  id: string;
  bookingId: string;
  type: DocumentType;
  /** The source: the payment id of a receipt, the invoice id, the cancellation or refund id, else the booking id. */
  referenceId: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

/** A downloaded file; `fileName` comes from `Content-Disposition` (null when the server sent none). */
export interface DownloadedFile {
  blob: Blob;
  fileName: string | null;
}
