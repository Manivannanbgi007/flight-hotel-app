import { apiClient } from '@/lib/api/client';
import { apiQueryOf, stayParams } from './searchParams';

/** Public `/api/hotels` endpoints (API_DOCUMENTATION.md §5). */
export const hotelApi = {
  async search(search, size = 20) {
    const { data } = await apiClient.get(`/hotels/search?${apiQueryOf(search, size).toString()}`);
    return data;
  },

  async destinations(query) {
    const { data } = await apiClient.get('/hotels/destinations', { params: { q: query } });
    return data;
  },

  async amenities() {
    const { data } = await apiClient.get('/hotels/amenities');
    return data;
  },

  async details(idOrSlug) {
    const { data } = await apiClient.get(`/hotels/${encodeURIComponent(idOrSlug)}`);
    return data;
  },

  async rooms(hotelId, stay) {
    const { data } = await apiClient.get(`/hotels/${encodeURIComponent(hotelId)}/rooms?${stayParams(stay).toString()}`);
    return data;
  },

  /** Re-checks availability and price; the quote is valid for 15 minutes. */
  async quote(body) {
    const { data } = await apiClient.post('/hotels/availability', body);
    return data;
  },

  async getQuote(quoteId) {
    const { data } = await apiClient.get(`/hotels/quotes/${encodeURIComponent(quoteId)}`);
    return data;
  },
};
