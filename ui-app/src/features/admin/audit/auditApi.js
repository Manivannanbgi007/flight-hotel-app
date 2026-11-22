import { apiClient } from '@/lib/api/client';

/** India midnight of a day as a UTC instant. */
export const startOfIndiaDay = (isoDate) => new Date(`${isoDate}T00:00:00+05:30`).toISOString();

/** The `to` day counts too, so the exclusive end is the next India midnight. */
export function endOfIndiaDayExclusive(isoDate) {
  const next = new Date(`${isoDate}T00:00:00+05:30`);
  next.setTime(next.getTime() + 86_400_000);
  return next.toISOString();
}

export const auditApi = {
  async list(filters, size = 25) {
    const { data } = await apiClient.get('/admin/audit-logs', {
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
