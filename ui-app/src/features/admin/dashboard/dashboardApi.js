import { analyticsApiParams } from '@/components/analytics/range';
import { apiClient } from '@/lib/api/client';

export const dashboardApi = {
  /** `?range=&from=&to=&interval=`: without an interval the server chooses one (echoed as `interval`). */
  async get(query) {
    const { data } = await apiClient.get('/admin/dashboard', { params: analyticsApiParams(query) });
    return data;
  },
};
