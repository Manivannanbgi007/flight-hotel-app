import { apiClient } from '@/lib/api/client';

/** Public `/api/flights` and `/api/airports` endpoints (API_DOCUMENTATION.md §5a). */
export const flightApi = {
  async searchAirports(query, limit = 8) {
    const { data } = await apiClient.get('/airports/search', { params: { q: query, limit } });
    return data;
  },

  async airlines() {
    const { data } = await apiClient.get('/flights/airlines');
    return data;
  },

  async popularRoutes() {
    const { data } = await apiClient.get('/flights/popular-routes');
    return data;
  },

  /** `query` is the URL-style query string built by `flightQueryOf`. */
  async search(query) {
    const { data } = await apiClient.get(`/flights/search?${query}`);
    return data;
  },

  /** Re-prices every flight at today's fare and checks the seats. Nothing is reserved. */
  async revalidate(offerIds) {
    const { data } = await apiClient.post('/flights/revalidate', { offerIds });
    return data;
  },

  async getTrip(tripOfferId) {
    const { data } = await apiClient.get(`/flights/trips/${encodeURIComponent(tripOfferId)}`);
    return data;
  },
};
