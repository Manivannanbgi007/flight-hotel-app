import { apiClient } from '@/lib/api/client';
import { rangeQuery } from '../shared/dateRange';

/** Admin reports (API_DOCUMENTATION.md §14.1) and the hotel occupancy across hotels (§14.5). */

const filterParams = (query) => ({
  ...rangeQuery(query.range),
  q: query.q || undefined,
  type: query.type || undefined,
  status: query.status || undefined,
  sort: query.sort || undefined,
});

export const reportApi = {
  async get(report, query, size = 20) {
    const { data } = await apiClient.get(`/admin/reports/${encodeURIComponent(report)}`, {
      params: { ...filterParams(query), page: query.page, size },
    });
    return data;
  },

  /** Occupancy and revenue per hotel for the range (hotel-service, ADMIN). */
  async occupancy(range) {
    const { data } = await apiClient.get('/admin/hotels/occupancy', { params: rangeQuery(range) });
    return data;
  },
};
