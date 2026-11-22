import { apiClient } from '@/lib/api/client';

/**
 * Global search (search-service). Works signed in or out: the token, when there is one, decides what may be found.
 * Pass TanStack Query's `signal`, so a request for words the person has already typed past is cancelled.
 */
export const searchApi = {
  /** The header's typeahead: the best few results of each category. */
  async suggest(q, signal) {
    const { data } = await apiClient.get('/search/suggest', { params: { q }, signal });
    return data;
  },

  /** The results page: every category's best results (`ALL`) or one page of one category. */
  async search({ q, category = 'ALL', page = 0, size = 10 }, signal) {
    const { data } = await apiClient.get('/search', { params: { q, category, page, size }, signal });
    return data;
  },
};
