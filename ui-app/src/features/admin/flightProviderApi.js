import { apiClient } from '@/lib/api/client';

export const flightProviderApi = {
  async list() {
    const { data } = await apiClient.get('/admin/flight-providers');
    return data;
  },

  async update(code, body) {
    const { data } = await apiClient.patch(`/admin/flight-providers/${encodeURIComponent(code)}`, body);
    return data;
  },

  async healthCheck(code) {
    const { data } = await apiClient.post(`/admin/flight-providers/${encodeURIComponent(code)}/health-check`);
    return data;
  },
};
