import { analyticsApiParams } from '@/components/analytics/range';

import { apiClient } from '@/lib/api/client';

export const supportMetricsApi = {
  async get(query) {
    const { data } = await apiClient.get('/admin/support/metrics', { params: analyticsApiParams(query) });
    return data;
  },
};
