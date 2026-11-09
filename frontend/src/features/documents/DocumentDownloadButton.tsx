import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { documentApi } from './documentApi';
import { downloadDocument, findDocument } from './documentDownload';
import type { BookingDocument, DocumentType } from './types';

interface DocumentDownloadButtonProps {
  bookingId: string;
  type: DocumentType;
  /** Visible text, e.g. "Download confirmation". */
  label: string;
  /** Full name for screen readers when several rows have the same button; must start with `label`. */
  accessibleName?: string;
  /** Shown when the booking has no document of this type yet. */
  notReadyText: string;
  /** Which document of the type to take when there are several (otherwise the newest). */
  prefer?: (document: BookingDocument) => boolean;
  className?: string;
}

/**
 * One click: loads the booking's documents (always fresh), then downloads the one of `type`, or says it is not ready
 * yet. Used where only the booking is known (My Trips, Payment history).
 */
export function DocumentDownloadButton({ bookingId, type, label, accessibleName, notReadyText, prefer, className }: DocumentDownloadButtonProps) {
  const queryClient = useQueryClient();
  const [notReady, setNotReady] = useState(false);
  const download = useMutation({
    mutationFn: async (): Promise<string | null> => {
      const documents = await queryClient.fetchQuery({
        queryKey: queryKeys.documents.forBooking(bookingId),
        queryFn: () => documentApi.list(bookingId),
        staleTime: 0,
      });
      const document = findDocument(documents, type, prefer);
      return document ? downloadDocument(document) : null;
    },
    onMutate: () => setNotReady(false),
    onSuccess: (savedAs) => setNotReady(savedAs === null),
  });
  const error = download.error ? ApiError.from(download.error) : null;

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <Button variant="secondary" size="sm" loading={download.isPending} aria-label={accessibleName} onClick={() => download.mutate()}>
        {!download.isPending && <Download className="size-4" aria-hidden="true" />}
        {label}
      </Button>
      {notReady && <p role="status" className="max-w-xs text-sm text-slate-600 animate-fade-in">{notReadyText}</p>}
      {error && (
        <p role="alert" className="max-w-xs text-sm text-danger-700">
          {error.message}
          {error.correlationId && <span className="block text-xs text-slate-500">Support reference: {error.correlationId}</span>}
        </p>
      )}
    </div>
  );
}
