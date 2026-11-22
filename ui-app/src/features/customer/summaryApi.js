import { apiClient } from '@/lib/api/client';

/**
 * `GET /api/bookings/summary` (API_DOCUMENTATION.md, Phase 11 analytics §3): the signed-in customer's own bookings,
 * trips, spending, monthly activity and next trip. Every figure is calculated by the booking service; the UI never
 * invents one.
 */

/** Query parameters as the endpoint wants them (no `from`/`to` for presets). */
export function summaryQuery(params) {
  return params.range === 'CUSTOM' && params.from && params.to
    ? { range: 'CUSTOM', from: params.from, to: params.to }
    : { range: params.range };
}

export const summaryApi = {
  async summary(params) {
    const { data } = await apiClient.get('/bookings/summary', { params: summaryQuery(params) });
    return data;
  },
};
