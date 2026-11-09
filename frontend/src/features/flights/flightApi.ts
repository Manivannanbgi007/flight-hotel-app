import { apiClient } from '@/lib/api/client';
import type { Airline, Airport, FlightSearchResponse, PopularRoute, TripOffer } from './types';

/** Public `/api/flights` and `/api/airports` endpoints (API_DOCUMENTATION.md §5a). */
export const flightApi = {
  async searchAirports(query: string, limit = 8): Promise<Airport[]> {
    const { data } = await apiClient.get<Airport[]>('/airports/search', { params: { q: query, limit } });
    return data;
  },

  async airlines(): Promise<Airline[]> {
    const { data } = await apiClient.get<Airline[]>('/flights/airlines');
    return data;
  },

  async popularRoutes(): Promise<PopularRoute[]> {
    const { data } = await apiClient.get<PopularRoute[]>('/flights/popular-routes');
    return data;
  },

  /** `query` is the URL-style query string built by `flightQueryOf`. */
  async search(query: string): Promise<FlightSearchResponse> {
    const { data } = await apiClient.get<FlightSearchResponse>(`/flights/search?${query}`);
    return data;
  },

  /** Re-prices every flight at today's fare and checks the seats. Nothing is reserved. */
  async revalidate(offerIds: string[]): Promise<TripOffer> {
    const { data } = await apiClient.post<TripOffer>('/flights/revalidate', { offerIds });
    return data;
  },

  async getTrip(tripOfferId: string): Promise<TripOffer> {
    const { data } = await apiClient.get<TripOffer>(`/flights/trips/${encodeURIComponent(tripOfferId)}`);
    return data;
  },
};
