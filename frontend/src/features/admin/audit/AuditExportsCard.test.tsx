import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { renderAdmin } from '../testUtils';
import { AuditExportsCard } from './AuditExportsCard';
import { auditExportApi, describeExportFilters, type AuditExportJob } from './auditExportApi';

const NO_FILTERS = { action: null, entityType: null, entityId: null, actorId: null, from: null, to: null };

const job = (overrides: Partial<AuditExportJob> = {}): AuditExportJob => ({
  id: 'job-1', format: 'XLSX', status: 'RUNNING', filters: NO_FILTERS, totalRows: 10_000_000, rowsWritten: 3_200_000,
  parts: 10, fileName: null, sizeBytes: null, error: null, createdAt: '2026-11-09T08:30:00Z', startedAt: '2026-11-09T08:30:02Z',
  finishedAt: null, expiresAt: null, ...overrides,
});

const render = () => renderAdmin([{ path: '/admin/audit-logs', element: <AuditExportsCard /> }], '/admin/audit-logs');

describe('AuditExportsCard', () => {
  it('is hidden while the admin has no exports', async () => {
    const list = vi.spyOn(auditExportApi, 'list').mockResolvedValue([]);
    render();

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Your exports' })).not.toBeInTheDocument();
  });

  it('shows the progress of a running export, and "counting" before the total is known', async () => {
    vi.spyOn(auditExportApi, 'list').mockResolvedValue([
      job(),
      job({ id: 'job-2', format: 'CSV', status: 'RUNNING', totalRows: null, rowsWritten: 0, filters: { ...NO_FILTERS, action: 'BOOKING_CANCELLED' } }),
      job({ id: 'job-3', status: 'QUEUED', totalRows: null, rowsWritten: 0 }),
    ]);
    render();

    const items = within(await screen.findByRole('list', { name: 'Your audit log exports' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Excel · All entries');
    expect(items[0]).toHaveTextContent('Preparing');
    // Indian digit grouping, as everywhere in the app.
    expect(items[0]).toHaveTextContent('32,00,000 of 1,00,00,000 rows');
    const bar = within(items[0]!).getByRole('progressbar');
    expect(bar).toHaveAttribute('value', '3200000');
    expect(bar).toHaveAttribute('max', '10000000');
    expect(items[1]).toHaveTextContent('CSV · Action: BOOKING_CANCELLED');
    expect(items[1]).toHaveTextContent('Counting rows…');
    expect(within(items[1]!).getByRole('progressbar')).not.toHaveAttribute('value');
    expect(items[2]).toHaveTextContent('Waiting');
    expect(items[2]).toHaveTextContent('Waiting to start…');
    expect(within(items[0]!).getByRole('button', { name: /^Cancel Excel export/ })).toBeInTheDocument();
    expect(within(items[0]!).queryByRole('button', { name: /^Download/ })).not.toBeInTheDocument();
  });

  it('downloads a ready file through a one-time link (the browser saves it, nothing is held in memory)', async () => {
    const files = stubFileSaving();
    vi.spyOn(auditExportApi, 'list').mockResolvedValue([job({
      status: 'READY', rowsWritten: 10_000_000, fileName: 'audit-logs-2026-11-09.zip', sizeBytes: 1_181_116_006,
      finishedAt: '2026-11-09T08:41:00Z', expiresAt: '2026-11-10T08:41:00Z',
    })]);
    const link = vi.spyOn(auditExportApi, 'link').mockResolvedValue({
      url: '/api/public/export-files/job-1?token=abc', expiresAt: '2026-11-09T09:00:00Z',
    });
    const { user } = render();

    const item = within(await screen.findByRole('list', { name: 'Your audit log exports' })).getByRole('listitem');
    expect(item).toHaveTextContent('Ready');
    expect(item).toHaveTextContent('1,00,00,000 rows · 1.1 GB · 10 Excel files in a .zip · available until');
    expect(within(item).queryByRole('progressbar')).not.toBeInTheDocument();

    await user.click(within(item).getByRole('button', { name: 'Download audit-logs-2026-11-09.zip' }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(link).toHaveBeenCalledWith('job-1');
    expect(files.saved[0]).toEqual({ href: 'http://localhost:3000/api/public/export-files/job-1?token=abc', fileName: 'audit-logs-2026-11-09.zip' });
    expect(files.createObjectURL).not.toHaveBeenCalled();
  });

  it('says why a download did not start', async () => {
    vi.spyOn(auditExportApi, 'list').mockResolvedValue([job({ status: 'READY', fileName: 'audit-logs-2026-11-09.xlsx', parts: 1 })]);
    vi.spyOn(auditExportApi, 'link').mockRejectedValue(new ApiError(409, 'EXPORT_NOT_READY', 'This export is not ready.'));
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Download audit-logs-2026-11-09.xlsx' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This export is not ready.');
  });

  it('shows why an export failed, and removes it', async () => {
    vi.spyOn(auditExportApi, 'list')
      .mockResolvedValueOnce([job({ status: 'FAILED', error: 'Interrupted by a service restart; start the export again.' })])
      .mockResolvedValue([]);
    const remove = vi.spyOn(auditExportApi, 'remove').mockResolvedValue(undefined);
    const { user } = render();

    const item = within(await screen.findByRole('list', { name: 'Your audit log exports' })).getByRole('listitem');
    expect(item).toHaveTextContent('Failed');
    expect(item).toHaveTextContent('Interrupted by a service restart; start the export again.');
    await user.click(within(item).getByRole('button', { name: /^Remove Excel export/ }));

    expect(remove).toHaveBeenCalledWith('job-1');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Your exports' })).not.toBeInTheDocument());
  });

  it('cancels a running export', async () => {
    vi.spyOn(auditExportApi, 'list').mockResolvedValueOnce([job()]).mockResolvedValue([]);
    const remove = vi.spyOn(auditExportApi, 'remove').mockResolvedValue(undefined);
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: /^Cancel Excel export/ }));

    expect(remove).toHaveBeenCalledWith('job-1');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Your audit log exports' })).not.toBeInTheDocument());
  });

  it('re-reads the list every few seconds only while an export is waiting or running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const list = vi.spyOn(auditExportApi, 'list').mockResolvedValueOnce([job()]).mockResolvedValue([job({ status: 'READY' })]);
      render();
      await screen.findByText('32,00,000 of 1,00,00,000 rows');
      expect(list).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000);
      await screen.findByText('Ready');
      expect(list).toHaveBeenCalledTimes(2);

      // Nothing runs any more: no further reads.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(list).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('describeExportFilters', () => {
  it('names the filters, with the India days of the range (the end is exclusive)', () => {
    expect(describeExportFilters(NO_FILTERS)).toBe('All entries');
    expect(describeExportFilters({
      ...NO_FILTERS, action: 'BOOKING_CANCELLED', entityType: 'BOOKING', from: '2026-10-31T18:30:00.000Z', to: '2026-11-05T18:30:00.000Z',
    })).toBe('Action: BOOKING_CANCELLED · Entity type: BOOKING · 1 Nov 2026 to 5 Nov 2026');
    expect(describeExportFilters({ ...NO_FILTERS, from: '2026-10-31T18:30:00.000Z' })).toBe('From 1 Nov 2026');
    expect(describeExportFilters({ ...NO_FILTERS, to: '2026-11-05T18:30:00.000Z' })).toBe('Until 5 Nov 2026');
  });
});
