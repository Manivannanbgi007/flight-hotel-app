import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';

/** `GET /api/admin/audit-logs` (API_DOCUMENTATION.md §11). Exact matches; `from` inclusive, `to` exclusive. */
export interface AuditLogEntry {
  id: string;
  occurredAt: string;
  service: string;
  actorId: string | null;
  actorRoles: string[];
  action: string;
  entityType: string;
  entityId: string | null;
  /** Ids and amounts only, never personal data or notes. */
  details: Record<string, unknown>;
  ipAddress: string | null;
  correlationId: string | null;
}

/** As kept in the URL: `from` / `to` are India days (both inclusive on screen). */
export type AuditFilters = {
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  from: string;
  to: string;
  page: number;
};

/** India midnight of a day as a UTC instant. */
export const startOfIndiaDay = (isoDate: string) => new Date(`${isoDate}T00:00:00+05:30`).toISOString();

/** The `to` day counts too, so the exclusive end is the next India midnight. */
export function endOfIndiaDayExclusive(isoDate: string): string {
  const next = new Date(`${isoDate}T00:00:00+05:30`);
  next.setTime(next.getTime() + 86_400_000);
  return next.toISOString();
}

export const auditApi = {
  async list(filters: AuditFilters, size = 25): Promise<Page<AuditLogEntry>> {
    const { data } = await apiClient.get<Page<AuditLogEntry>>('/admin/audit-logs', {
      params: {
        action: filters.action || undefined,
        entityType: filters.entityType || undefined,
        entityId: filters.entityId || undefined,
        actorId: filters.actorId || undefined,
        from: filters.from ? startOfIndiaDay(filters.from) : undefined,
        to: filters.to ? endOfIndiaDayExclusive(filters.to) : undefined,
        page: filters.page,
        size,
      },
    });
    return data;
  },
};
