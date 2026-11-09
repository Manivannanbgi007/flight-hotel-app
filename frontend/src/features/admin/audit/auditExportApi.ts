import { apiClient } from '@/lib/api/client';
import { openDownloadLink } from '@/lib/download';
import { formatDate } from '@/lib/format';
import { endOfIndiaDayExclusive, startOfIndiaDay, type AuditFilters } from './auditApi';

/**
 * Audit log exports prepared on the server (API_DOCUMENTATION.md §11): too many rows for the browser (more than
 * `EXPORT_ROW_LIMIT`), so reporting-service writes the file in the background, says when it is ready
 * (`export.status-changed`), and keeps it for a day. Only the admin who asked sees the job and can download the file.
 */

/** A cancelled job is deleted (it leaves the list), so there is no "cancelled" status. */
export type AuditExportStatus = 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';
export type AuditExportFormat = 'XLSX' | 'CSV';

/** As sent: `from` / `to` are UTC instants (`to` exclusive); null = not set. */
export interface AuditExportFilters {
  action: string | null;
  entityType: string | null;
  entityId: string | null;
  actorId: string | null;
  from: string | null;
  to: string | null;
}

export interface AuditExportJob {
  id: string;
  format: AuditExportFormat;
  status: AuditExportStatus;
  filters: AuditExportFilters;
  /** Null until the job has counted the rows. */
  totalRows: number | null;
  rowsWritten: number;
  /** Excel files in the download; more than one means a .zip of parts (at most 1,000,000 rows each). */
  parts: number | null;
  /** Set when ready, e.g. `audit-logs-2026-11-09.zip`. */
  fileName: string | null;
  sizeBytes: number | null;
  /** Why it failed, in words for the admin. */
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** The file is deleted after this (ready jobs). */
  expiresAt: string | null;
}

/** A one-time download URL (a path of this site), valid for a minute. */
export interface AuditExportLink {
  url: string;
  expiresAt: string;
}

export const isExportActive = (job: Pick<AuditExportJob, 'status'>) => job.status === 'QUEUED' || job.status === 'RUNNING';

/** The India day of an instant (`2026-10-31T18:30:00Z` → `2026-11-01`). */
const indiaDay = (instant: string, offsetMs = 0) =>
  new Date(new Date(instant).getTime() + offsetMs + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** "Action: BOOKING_CANCELLED · 1 Nov 2026 to 5 Nov 2026", or "All entries". */
export function describeExportFilters(filters: AuditExportFilters): string {
  const parts: string[] = [];
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
const jobPath = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export const auditExportApi = {
  /** Every row matching `filters` (the page number is ignored), as the file says who exported. */
  async request(filters: AuditFilters, format: AuditExportFormat, exportedBy?: string): Promise<AuditExportJob> {
    const { data } = await apiClient.post<AuditExportJob>(BASE, {
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
  async list(): Promise<AuditExportJob[]> {
    const { data } = await apiClient.get<AuditExportJob[]>(BASE);
    return data;
  },

  /** Cancels a waiting or running job, or removes a finished one and its file. */
  async remove(id: string): Promise<void> {
    await apiClient.delete(jobPath(id));
  },

  async link(id: string): Promise<AuditExportLink> {
    const { data } = await apiClient.post<AuditExportLink>(`${jobPath(id)}/link`);
    return data;
  },
};

/**
 * Downloads a ready export: a one-time link, opened by the browser's download manager (the file can be a gigabyte, so
 * it is never fetched into memory).
 */
export async function downloadAuditExport(job: Pick<AuditExportJob, 'id'> & { fileName?: string | null }): Promise<void> {
  const { url } = await auditExportApi.link(job.id);
  openDownloadLink(url, job.fileName ?? '');
}
