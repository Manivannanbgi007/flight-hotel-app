import { useId } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileText, FolderOpen } from 'lucide-react';

import { usePollingFallback } from '@/app/providers/useRealtime';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { DetailCard } from '@/features/bookings/BookingUi';
import { isConfirmed, isProcessing } from '@/features/bookings/status';
import type { BookingDetails } from '@/features/bookings/types';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime, formatFileSize } from '@/lib/format';
import { documentApi } from './documentApi';
import { documentTypeLabels, downloadDocument, hasCapturedPayment } from './documentDownload';
import type { BookingDocument } from './types';

const titleOf = (document: BookingDocument) => document.title || documentTypeLabels[document.type] || 'Document';

/**
 * "Documents" on the booking page: confirmation, e-tickets, invoice and receipts, each downloaded with the user's token.
 * New PDFs appear live (`document.created`); while a confirmed booking still waits for its first PDF and live updates
 * are not connected, the list is polled.
 */
export function DocumentsCard({ booking }: { booking: BookingDetails }) {
  const headingId = useId();
  const confirmed = isConfirmed(booking.status);
  // Before payment there is nothing to show; after a captured payment there is at least a receipt.
  const enabled = confirmed || hasCapturedPayment(booking.paymentStatus);
  const expectingDocuments = confirmed || isProcessing(booking.status);
  const fallback = usePollingFallback(10_000);
  const documents = useQuery({
    queryKey: queryKeys.documents.forBooking(booking.id),
    queryFn: () => documentApi.list(booking.id),
    enabled,
    refetchInterval: (query) => (expectingDocuments && query.state.data?.length === 0 ? fallback : false),
  });
  const download = useMutation({ mutationFn: downloadDocument });

  // A cancelled or failed booking only shows the card when it has documents (no loading box that then disappears).
  if (!enabled || (!expectingDocuments && (documents.isPending || documents.data?.length === 0))) {
    return null;
  }
  const loadError = documents.isError ? ApiError.from(documents.error) : null;
  const downloadError = download.error ? ApiError.from(download.error) : null;

  return (
    <section aria-labelledby={headingId}>
      <DetailCard title="Documents" headingId={headingId} icon={<FolderOpen />}>
        {documents.isPending && (
          <>
            <span role="status" className="sr-only">Loading documents…</span>
            <Skeleton className="mt-4 h-14 w-full rounded-xl" />
          </>
        )}
        {loadError && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm" role="alert">
            <p className="text-danger-700">
              We could not load your documents. {loadError.message}
              {loadError.correlationId && <span className="block text-xs text-slate-500">Support reference: {loadError.correlationId}</span>}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void documents.refetch()}>Try again</Button>
          </div>
        )}
        {documents.data?.length === 0 && (
          <p className="mt-3 text-sm text-slate-600">
            Documents appear a few seconds after confirmation. This list updates by itself, and we also e-mail them to you.
          </p>
        )}
        {documents.data && documents.data.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2" aria-label="Documents of this booking">
            {documents.data.map((document) => {
              const busy = download.isPending && download.variables?.id === document.id;
              return (
                <li key={document.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2.5 transition-colors duration-(--duration-fast) hover:border-role-200 hover:bg-role-50/40">
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-role-600 shadow-xs ring-1 ring-slate-200">
                      <FileText className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-slate-900">{titleOf(document)}</p>
                      <p className="text-xs text-slate-500">
                        PDF{document.sizeBytes ? ` · ${formatFileSize(document.sizeBytes)}` : ''} · {formatDateTime(document.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" loading={busy} aria-label={`Download ${titleOf(document)}`}
                    onClick={() => download.mutate(document)}>
                    {!busy && <Download className="size-4" aria-hidden="true" />}
                    Download
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {downloadError && (
          <Alert tone="danger" className="mt-3" title="The download did not work">
            {downloadError.message}
            {downloadError.correlationId && <span className="block text-xs">Support reference: {downloadError.correlationId}</span>}
          </Alert>
        )}
      </DetailCard>
    </section>
  );
}
