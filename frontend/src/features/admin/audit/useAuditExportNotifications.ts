import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { useRealtimeEvent } from '@/app/providers/useRealtime';
import { ApiError } from '@/lib/api/apiError';
import { downloadAuditExport } from './auditExportApi';

/** Sent to the admin who asked for an export, while it runs and once when it is ready or has failed. */
export const EXPORT_STATUS_EVENT = 'export.status-changed';

/**
 * Anywhere in the admin portal: a toast when one of the admin's audit log exports is ready (with Download) or has
 * failed. One toast per export (a repeated message updates it instead of stacking).
 */
export function useAuditExportNotifications(): void {
  const navigate = useNavigate();
  useRealtimeEvent(EXPORT_STATUS_EVENT, (message) => {
    const id = message.resourceId;
    if (!id) return;
    if (message.data.status === 'READY') {
      toast.success('Audit log export ready', {
        id: `audit-export-${id}`,
        description: 'Download it now, or later from Your exports on the Audit logs page.',
        duration: 20_000,
        action: {
          label: 'Download',
          onClick: () => {
            downloadAuditExport({ id }).catch((error: unknown) =>
              toast.error('The download did not start', { description: ApiError.from(error).message }));
          },
        },
      });
    } else if (message.data.status === 'FAILED') {
      toast.error('Audit log export failed', {
        id: `audit-export-${id}`,
        description: 'Your exports on the Audit logs page says why.',
        action: { label: 'Open', onClick: () => void navigate('/admin/audit-logs') },
      });
    }
  });
}
