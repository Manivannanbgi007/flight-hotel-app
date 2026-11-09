import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { apiClient } from '@/lib/api/client';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation } from '@/test/renderRoutes';
import { adminWithout, pageOf, renderAdmin } from '../testUtils';
import { AdminAuditLogsPage } from './AdminAuditLogsPage';
import { auditApi, type AuditLogEntry } from './auditApi';
import { auditExportApi, type AuditExportJob } from './auditExportApi';

const entry = (overrides: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: 'a1', occurredAt: '2026-11-05T09:30:00Z', service: 'booking-service', actorId: 'admin-1', actorRoles: ['ADMIN'],
  action: 'REFUND_GOODWILL_REQUESTED', entityType: 'BOOKING', entityId: 'b1', details: { amount: 500, refundId: 'r9', waived: false },
  ipAddress: '10.0.0.5', correlationId: 'corr-a1', ...overrides,
});

const routes = [{ path: '/admin/audit-logs', element: <AdminAuditLogsPage /> }];

describe('AdminAuditLogsPage', () => {
  beforeEach(() => {
    // "Your exports": none unless a test says otherwise.
    vi.spyOn(auditExportApi, 'list').mockResolvedValue([]);
  });

  it('lists entries with the details as key / value pairs', async () => {
    vi.spyOn(auditApi, 'list').mockResolvedValue(pageOf([entry(), entry({ id: 'a2', actorId: null, actorRoles: [], action: 'BOOKING_EXPIRED', details: {} })]));
    const { user } = renderAdmin(routes, '/admin/audit-logs');

    const table = await screen.findByRole('table', { name: 'Audit log entries' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('Refund goodwill requested');
    expect(first).toHaveTextContent('Admin');
    expect(second).toHaveTextContent('System');

    await user.click(within(first!).getByText('3 details'));
    const terms = within(first!).getAllByRole('term').map((term) => term.textContent);
    const values = within(first!).getAllByRole('definition').map((value) => value.textContent);
    expect(terms).toEqual(['amount', 'refundId', 'waived', 'Service', 'IP address', 'Correlation id']);
    expect(values).toEqual(['500', 'r9', 'false', 'booking-service', '10.0.0.5', 'corr-a1']);
  });

  it('exports the page on screen, and every matching entry with the same filters', async () => {
    const files = stubFileSaving();
    const list = vi.spyOn(auditApi, 'list').mockImplementation(async (filters) =>
      pageOf([entry({ id: `a${filters.page}` })], { page: filters.page, totalElements: 2, totalPages: 2 }));
    const { user } = renderAdmin(routes, '/admin/audit-logs?action=REFUND_GOODWILL_REQUESTED');
    await screen.findByRole('table', { name: 'Audit log entries' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.saved).toHaveLength(1));
    const lines = (await files.blobs[0]!.text()).trim().split('\r\n');
    expect(lines[0]).toBe('"When","Action","Action code","Entity type","Entity id","Actor","Actor id","Details","Service","IP address",'
      + '"Correlation id"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(new RegExp('^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2},"Refund goodwill requested","REFUND_GOODWILL_REQUESTED","Booking","b1",'
      + '"Admin","admin-1","amount: 500; refundId: r9; waived: false","booking-service","10\\.0\\.0\\.5","corr-a1"$'));

    list.mockClear();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.saved).toHaveLength(2));
    expect(list.mock.calls).toEqual([0, 1].map((page) => [{
      action: 'REFUND_GOODWILL_REQUESTED', entityType: '', entityId: '', actorId: '', from: '', to: '', page,
    }, 100]));
  });

  it('asks the server for every matching entry when there are too many for the browser, and follows the export', async () => {
    vi.spyOn(auditApi, 'list').mockResolvedValue(pageOf([entry()], { totalElements: 10_000_000, totalPages: 400_000, size: 25 }));
    const queued: AuditExportJob = {
      id: 'job-1', format: 'XLSX', status: 'QUEUED',
      filters: { action: 'REFUND_GOODWILL_REQUESTED', entityType: null, entityId: null, actorId: null, from: '2026-10-31T18:30:00.000Z', to: null },
      totalRows: null, rowsWritten: 0, parts: null, fileName: null, sizeBytes: null, error: null, createdAt: '2026-11-09T08:30:00Z',
      startedAt: null, finishedAt: null, expiresAt: null,
    };
    const request = vi.spyOn(auditExportApi, 'request').mockResolvedValue(queued);
    vi.mocked(auditExportApi.list).mockResolvedValueOnce([]).mockResolvedValue([queued]);
    const { user } = renderAdmin(routes, '/admin/audit-logs?action=REFUND_GOODWILL_REQUESTED&from=2026-11-01');
    await screen.findByRole('table', { name: 'Audit log entries' });
    expect(screen.queryByRole('heading', { name: 'Your exports' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    expect(screen.getByText(/the server prepares the file/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Excel/ }));

    await waitFor(() => expect(request).toHaveBeenCalledWith({
      action: 'REFUND_GOODWILL_REQUESTED', entityType: '', entityId: '', actorId: '', from: '2026-11-01', to: '', page: 0,
    }, 'XLSX', 'Asha Rao (Administrator)'));
    expect(await screen.findByText('Preparing your export')).toBeInTheDocument();
    const exports = await screen.findByRole('list', { name: 'Your audit log exports' });
    expect(exports).toHaveTextContent('Excel · Action: REFUND_GOODWILL_REQUESTED · From 1 Nov 2026');
    expect(exports).toHaveTextContent('Waiting to start…');
  });

  it('sends the export request with the India days as instants, like the list', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} });

    await auditExportApi.request({
      action: 'BOOKING_CANCELLED', entityType: '', entityId: '', actorId: 'u1', from: '2026-11-01', to: '2026-11-05', page: 3,
    }, 'CSV', 'Asha Rao (Administrator)');

    expect(post).toHaveBeenCalledWith('/admin/audit-logs/exports', {
      format: 'CSV', action: 'BOOKING_CANCELLED', entityType: undefined, entityId: undefined, actorId: 'u1',
      from: '2026-10-31T18:30:00.000Z', to: '2026-11-05T18:30:00.000Z', exportedBy: 'Asha Rao (Administrator)',
    });
  });

  it('filters by action, entity, actor and India days, sent as instants (to is exclusive)', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: pageOf([]) });
    const { user, router } = renderAdmin(routes, '/admin/audit-logs');
    await screen.findByText('No entries found');

    await user.type(screen.getByLabelText(/Action/), 'BOOKING_CANCELLED');
    await user.type(screen.getByLabelText(/Entity type/), 'BOOKING');
    await user.type(screen.getByLabelText(/Actor id/), 'u1');
    await user.type(screen.getByRole('combobox', { name: /^From/ }), '2026-11-01');
    await user.type(screen.getByRole('combobox', { name: /^To/ }), '2026-11-05');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/admin/audit-logs', { params: {
      action: 'BOOKING_CANCELLED', entityType: 'BOOKING', entityId: undefined, actorId: 'u1',
      from: '2026-10-31T18:30:00.000Z', to: '2026-11-05T18:30:00.000Z', page: 0, size: 25,
    } }));
    expect(currentLocation(router)).toBe('/admin/audit-logs?action=BOOKING_CANCELLED&entityType=BOOKING&actorId=u1&from=2026-11-01&to=2026-11-05');
  });

  it('refuses an end date before the start date', async () => {
    vi.spyOn(auditApi, 'list').mockResolvedValue(pageOf([]));
    const { user } = renderAdmin(routes, '/admin/audit-logs');
    await screen.findByText('No entries found');

    await user.type(screen.getByRole('combobox', { name: /^From/ }), '2026-11-05');
    await user.type(screen.getByRole('combobox', { name: /^To/ }), '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(screen.getByText('The start date must be on or before the end date.')).toBeInTheDocument();
    expect(auditApi.list).toHaveBeenCalledTimes(1);
  });

  it('shows loading errors with the support reference', async () => {
    vi.spyOn(auditApi, 'list').mockRejectedValue(new ApiError(500, 'HTTP_500', 'Something went wrong on our side. Please try again later.', [], 'corr-15'));
    renderAdmin(routes, '/admin/audit-logs');

    expect(await screen.findByText('Support reference: corr-15')).toBeInTheDocument();
  });

  it('is closed without AUDIT_VIEW', () => {
    const list = vi.spyOn(auditApi, 'list');
    renderAdmin(routes, '/admin/audit-logs', adminWithout('AUDIT_VIEW'));

    expect(screen.getByRole('heading', { name: "You don't have access to this section" })).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
});
