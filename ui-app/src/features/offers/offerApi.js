import { apiClient } from '@/lib/api/client';

/** Offers change rarely: the list is kept for 5 minutes (offers page and home page). */
export const OFFERS_STALE_MS = 5 * 60_000;

export const offerApi = {
  async list() {
    const { data } = await apiClient.get('/offers');
    return Array.isArray(data) ? data : [];
  },
};
