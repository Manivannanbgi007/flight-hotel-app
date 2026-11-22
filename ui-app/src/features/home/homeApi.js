import { apiClient } from '@/lib/api/client';

const list = (data) => (Array.isArray(data) ? data : []);

/** Public home page data (API_DOCUMENTATION.md §14.1 and §14.5). */
export const homeApi = {
  async popularDestinations(limit = 8) {
    const { data } = await apiClient.get('/public/popular-destinations', { params: { limit } });
    return list(data);
  },
  async popularRoutes(limit = 6) {
    const { data } = await apiClient.get('/public/popular-routes', { params: { limit } });
    return list(data);
  },
  async recommendedHotels(limit = 6) {
    const { data } = await apiClient.get('/hotels/recommended', { params: { limit } });
    return list(data);
  },
};

/** Shown when nobody has booked flights yet (new system): well-known routes, labelled as suggestions. */
export const SUGGESTED_ROUTES = [
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
export function mergeDestinations(popular, catalogue) {
  const result = [];
  const seen = new Set();
  const add = (city, note) => {
    const key = city.trim().toLowerCase();
    if (!key || seen.has(key) || result.length >= MAX_DESTINATIONS) return;
    seen.add(key);
    result.push({ city: city.trim(), note });
  };
  for (const item of popular ?? [])
    add(item.city, `${item.bookings} booking${item.bookings === 1 ? '' : 's'} recently`);
  if (result.length < MIN_POPULAR_DESTINATIONS) {
    for (const item of catalogue ?? []) add(item.city, `${item.hotels} hotel${item.hotels === 1 ? '' : 's'}`);
  }
  return result;
}
