import { apiClient } from '@/lib/api/client';

export type HealthStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

/** `/api/admin/flight-providers` (API_DOCUMENTATION.md §10a). */
export interface FlightProvider {
  code: string;
  name: string;
  enabled: boolean;
  demo: boolean;
  priority: number;
  timeoutMs: number;
  healthStatus: HealthStatus;
  healthCheckedAt: string | null;
  lastError: string | null;
}

export const flightProviderApi = {
  async list(): Promise<FlightProvider[]> {
    const { data } = await apiClient.get<FlightProvider[]>('/admin/flight-providers');
    return data;
  },

  async update(code: string, body: { enabled?: boolean; priority?: number }): Promise<FlightProvider> {
    const { data } = await apiClient.patch<FlightProvider>(`/admin/flight-providers/${encodeURIComponent(code)}`, body);
    return data;
  },

  async healthCheck(code: string): Promise<FlightProvider> {
    const { data } = await apiClient.post<FlightProvider>(`/admin/flight-providers/${encodeURIComponent(code)}/health-check`);
    return data;
  },
};
