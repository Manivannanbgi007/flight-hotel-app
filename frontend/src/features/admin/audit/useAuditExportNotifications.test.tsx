import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { realtimeBus } from '@/lib/realtime/eventBus';
import type { RealtimeMessage } from '@/lib/realtime/types';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation } from '@/test/renderRoutes';
import { renderAdmin } from '../testUtils';
import { auditExportApi } from './auditExportApi';
import { EXPORT_STATUS_EVENT, useAuditExportNotifications } from './useAuditExportNotifications';

function Listener() {
  useAuditExportNotifications();
  return <p>Some admin page</p>;
}

const statusChanged = (status: string, id = 'job-1'): RealtimeMessage => ({
  id: `m-${status}`, type: EXPORT_STATUS_EVENT, resourceType: 'EXPORT', resourceId: id,
  data: { status, rowsWritten: 10, totalRows: 10 }, occurredAt: '2026-11-09T08:41:00Z',
});

const render = () => renderAdmin([
  { path: '/admin/users', element: <Listener /> },
  { path: '/admin/audit-logs', element: <p>Audit logs page</p> },
], '/admin/users');

describe('useAuditExportNotifications', () => {
  it('says when an export is ready, anywhere in the portal, and downloads it from the toast', async () => {
    const files = stubFileSaving();
    const link = vi.spyOn(auditExportApi, 'link').mockResolvedValue({ url: '/api/public/export-files/job-1?token=t1', expiresAt: '2026-11-09T08:42:00Z' });
    render();

    // Progress messages make no toast.
    act(() => realtimeBus.publish(statusChanged('RUNNING')));
    expect(screen.queryByText('Audit log export ready')).not.toBeInTheDocument();

    act(() => realtimeBus.publish(statusChanged('READY')));
    expect(await screen.findByText('Audit log export ready')).toBeInTheDocument();
    // A click without pointer events: sonner captures the pointer on the toast, which jsdom cannot do.
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(link).toHaveBeenCalledWith('job-1');
    expect(files.saved[0]!.href).toBe('http://localhost:3000/api/public/export-files/job-1?token=t1');
  });

  it('shows one toast per export even when the message comes twice', async () => {
    render();

    act(() => realtimeBus.publish(statusChanged('READY')));
    act(() => realtimeBus.publish(statusChanged('READY')));

    await screen.findByText('Audit log export ready');
    expect(screen.getAllByText('Audit log export ready')).toHaveLength(1);
  });

  it('says when an export failed, with a way to the audit logs page', async () => {
    const { router } = render();

    act(() => realtimeBus.publish(statusChanged('FAILED')));
    expect(await screen.findByText('Audit log export failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/admin/audit-logs'));
  });
});
