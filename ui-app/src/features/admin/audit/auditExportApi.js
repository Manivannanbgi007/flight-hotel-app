import { apiClient } from '@/lib/api/client';
import { openDownloadLink } from '@/lib/download';
import { formatDate } from '@/lib/format';
import { endOfIndiaDayExclusive, startOfIndiaDay } from './auditApi';

/**
 * Audit log exports prepared on the server (API_DOCUMENTATION.md §11): too many rows for the browser (more than
 * `EXPORT_ROW_LIMIT`), so reporting-service writes the file in the background, says when it is ready
 * (`export.status-changed`), and keeps it for a day. Only the admin who asked sees the job and can download the file.
 */

export const isExportActive = (job) => job.status === 'QUEUED' || job.status === 'RUNNING';

/** The India day of an instant (`2026-10-31T18:30:00Z` → `2026-11-01`). */
const indiaDay = (instant, offsetMs = 0) =>
  new Date(new Date(instant).getTime() + offsetMs + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** "Action: BOOKING_CANCELLED · 1 Nov 2026 to 5 Nov 2026", or "All entries". */
export function describeExportFilters(filters) {
  const parts = [];
  if (filters.action) parts.push(`Action: ${filters.action}`);
  if (filters.entityType) parts.push(`Entity type: ${filters.entityType}`);
  if (filters.entityId) parts.push(`Entity id: ${filters.entityId}`);
  if (filters.actorId) parts.push(`Actor id: ${filters.actorId}`);
  // `to` is the exclusive end (the next India midnight): the last day shown is the day before.
  const from = filters.from ? formatDate(indiaDay(filters.from)) : null;
  const to = filters.to ? formatDate(indiaDay(filters.to, -1)) : null;
  if (from && to) parts.push(`${from} to ${to}`);
  else if (from) parts.push(`From ${from}`);
  else if (to) parts.push(`Until ${to}`);
  return parts.length > 0 ? parts.join(' · ') : 'All entries';
}

const BASE = '/admin/audit-logs/exports';
const jobPath = (id) => `${BASE}/${encodeURIComponent(id)}`;

export const auditExportApi = {
  /** Every row matching `filters` (the page number is ignored), as the file says who exported. */
  async request(filters, format, exportedBy) {
    const { data } = await apiClient.post(BASE, {
      format,
      action: filters.action || undefined,
      entityType: filters.entityType || undefined,
      entityId: filters.entityId || undefined,
      actorId: filters.actorId || undefined,
      from: filters.from ? startOfIndiaDay(filters.from) : undefined,
      to: filters.to ? endOfIndiaDayExclusive(filters.to) : undefined,
      exportedBy: exportedBy || undefined,
    });
    return data;
  },

  /** The admin's own jobs of the last 7 days, newest first. */
  async list() {
    const { data } = await apiClient.get(BASE);
    return data;
  },

  /** Cancels a waiting or running job, or removes a finished one and its file. */
  async remove(id) {
    await apiClient.delete(jobPath(id));
  },

  async link(id) {
    const { data } = await apiClient.post(`${jobPath(id)}/link`);
    return data;
  },
};

/**
 * Downloads a ready export: a one-time link, opened by the browser's download manager (the file can be a gigabyte, so
 * it is never fetched into memory).
 */
export async function downloadAuditExport(job) {
  const { url } = await auditExportApi.link(job.id);
  openDownloadLink(url, job.fileName ?? '');
}
