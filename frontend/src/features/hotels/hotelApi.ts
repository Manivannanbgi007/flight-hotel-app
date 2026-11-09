import { apiClient } from '@/lib/api/client';
import { apiQueryOf, stayParams, type HotelSearch } from './searchParams';
import type { Amenity, DestinationSuggestion, HotelDetails, Quote, RoomsResponse, SearchResponse, Stay } from './types';

/** Public `/api/hotels` endpoints (API_DOCUMENTATION.md §5). */
export const hotelApi = {
  async search(search: HotelSearch, size = 20): Promise<SearchResponse> {
    const { data } = await apiClient.get<SearchResponse>(`/hotels/search?${apiQueryOf(search, size).toString()}`);
    return data;
  },

  async destinations(query: string): Promise<DestinationSuggestion[]> {
    const { data } = await apiClient.get<DestinationSuggestion[]>('/hotels/destinations', { params: { q: query } });
    return data;
  },

  async amenities(): Promise<Amenity[]> {
    const { data } = await apiClient.get<Amenity[]>('/hotels/amenities');
    return data;
  },

  async details(idOrSlug: string): Promise<HotelDetails> {
    const { data } = await apiClient.get<HotelDetails>(`/hotels/${encodeURIComponent(idOrSlug)}`);
    return data;
  },

  async rooms(hotelId: string, stay: Stay): Promise<RoomsResponse> {
    const { data } = await apiClient.get<RoomsResponse>(
      `/hotels/${encodeURIComponent(hotelId)}/rooms?${stayParams(stay).toString()}`,
    );
    return data;
  },

  /** Re-checks availability and price; the quote is valid for 15 minutes. */
  async quote(body: { hotelId: string; roomTypeId: string; ratePlanId: string; stay: Stay }): Promise<Quote> {
    const { data } = await apiClient.post<Quote>('/hotels/availability', body);
    return data;
  },

  async getQuote(quoteId: string): Promise<Quote> {
    const { data } = await apiClient.get<Quote>(`/hotels/quotes/${encodeURIComponent(quoteId)}`);
    return data;
  },
};
