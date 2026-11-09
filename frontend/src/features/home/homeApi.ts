import { apiClient } from '@/lib/api/client';

/** `GET /api/public/popular-destinations`: cities by paid bookings of the last 90 days (may be few or none). */
export interface PopularDestination {
  city: string;
  bookings: number;
}

/** `GET /api/public/popular-routes`: routes by paid flight bookings of the last 90 days (may be few or none). */
export interface PopularFlightRoute {
  origin: string;
  destination: string;
  originCity: string;
  destinationCity: string;
  bookings?: number;
}

/** `GET /api/hotels/recommended`: active hotels by guest rating. */
export interface RecommendedHotel {
  id: string;
  slug: string;
  name: string;
  city: string;
  starRating: number | null;
  guestRating: number | null;
  reviewCount: number;
  imageUrl: string | null;
  /** Lowest price per night, before taxes. */
  priceFrom: number | null;
  demo: boolean;
}

const list = <T,>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

/** Public home page data (API_DOCUMENTATION.md §14.1 and §14.5). */
export const homeApi = {
  async popularDestinations(limit = 8): Promise<PopularDestination[]> {
    const { data } = await apiClient.get<PopularDestination[]>('/public/popular-destinations', { params: { limit } });
    return list(data);
  },
  async popularRoutes(limit = 6): Promise<PopularFlightRoute[]> {
    const { data } = await apiClient.get<PopularFlightRoute[]>('/public/popular-routes', { params: { limit } });
    return list(data);
  },
  async recommendedHotels(limit = 6): Promise<RecommendedHotel[]> {
    const { data } = await apiClient.get<RecommendedHotel[]>('/hotels/recommended', { params: { limit } });
    return list(data);
  },
};

/** Shown when nobody has booked flights yet (new system): well-known routes, labelled as suggestions. */
export const SUGGESTED_ROUTES: readonly PopularFlightRoute[] = [
  { origin: 'DEL', destination: 'BOM', originCity: 'Delhi', destinationCity: 'Mumbai' },
  { origin: 'BOM', destination: 'GOI', originCity: 'Mumbai', destinationCity: 'Goa' },
  { origin: 'BLR', destination: 'DEL', originCity: 'Bengaluru', destinationCity: 'Delhi' },
  { origin: 'MAA', destination: 'HYD', originCity: 'Chennai', destinationCity: 'Hyderabad' },
];

/** Fewer popular destinations than this: top the list up with cities that have hotels. */
export const MIN_POPULAR_DESTINATIONS = 4;
export const MAX_DESTINATIONS = 8;

/**
 * Popular destinations first; when there are only a few (or none), the catalogue's cities fill the rest. Each city
 * appears once (case-insensitive).
 */
export function mergeDestinations(
  popular: readonly PopularDestination[] | undefined,
  catalogue: readonly { city: string; hotels: number }[] | undefined,
): { city: string; note: string }[] {
  const result: { city: string; note: string }[] = [];
  const seen = new Set<string>();
  const add = (city: string, note: string) => {
    const key = city.trim().toLowerCase();
    if (!key || seen.has(key) || result.length >= MAX_DESTINATIONS) return;
    seen.add(key);
    result.push({ city: city.trim(), note });
  };
  for (const item of popular ?? []) add(item.city, `${item.bookings} booking${item.bookings === 1 ? '' : 's'} recently`);
  if (result.length < MIN_POPULAR_DESTINATIONS) {
    for (const item of catalogue ?? []) add(item.city, `${item.hotels} hotel${item.hotels === 1 ? '' : 's'}`);
  }
  return result;
}
