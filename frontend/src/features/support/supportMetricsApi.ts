import type { Change } from '@/components/analytics/growth';
import { analyticsApiParams, type AnalyticsInterval, type AnalyticsQuery, type AnalyticsRangeEcho } from '@/components/analytics/range';
import type { TicketCategory, TicketStatus } from '@/features/tickets/types';
import { apiClient } from '@/lib/api/client';

export type TicketAgeBucket = 'UNDER_1_DAY' | '1_TO_3_DAYS' | '3_TO_7_DAYS' | 'OVER_7_DAYS';

/** One point of the opened / resolved series. */
export type SupportMetricsPoint = { key: string; start: string; end: string; opened: number; resolved: number };

/**
 * `GET /api/admin/support/metrics` (api-analytics §5, permission SUPPORT_TICKET_MANAGE). `byStatus`, `open` and `age`
 * are about all tickets now; `opened`, `resolved`, `openedByCategory`, `firstResponse`, `resolution` and `series` about
 * the range. Times are wall-clock time.
 */
export interface SupportMetrics {
  range: AnalyticsRangeEcho;
  interval: AnalyticsInterval;
  previousRange: AnalyticsRangeEcho;
  byStatus: Record<TicketStatus, number>;
  open: number;
  age: {
    buckets: { key: TicketAgeBucket; label: string; count: number }[];
    averageHours: number | null;
    oldestOpenedAt: string | null;
  };
  opened: number;
  resolved: number;
  openedByCategory: Record<TicketCategory, number>;
  firstResponse: { averageMinutes: number | null; medianMinutes: number | null; responded: number; awaiting: number };
  resolution: { resolved: number; averageHours: number | null };
  series: SupportMetricsPoint[];
  comparison: {
    opened: Change;
    resolved: Change;
    /** Null when either period has no answered ticket; down is good. */
    averageFirstResponseMinutes: Change | null;
  };
  generatedAt: string;
}

export const supportMetricsApi = {
  async get(query: AnalyticsQuery): Promise<SupportMetrics> {
    const { data } = await apiClient.get<SupportMetrics>('/admin/support/metrics', { params: analyticsApiParams(query) });
    return data;
  },
};
