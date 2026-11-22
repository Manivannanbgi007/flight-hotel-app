import { apiClient } from '@/lib/api/client';

export const reviewModerationApi = {
  async list(filters, size = 20) {
    const { data } = await apiClient.get('/admin/reviews', {
      params: {
        ...(filters.queue === 'REPORTED' ? { reported: true } : { status: filters.queue }),
        q: filters.q || undefined,
        page: filters.page,
        size,
      },
    });
    return data;
  },

  /** Shows the review (updates the hotel's rating) and clears its open reports. */
  async approve(reviewId) {
    const { data } = await apiClient.post(`/admin/reviews/${encodeURIComponent(reviewId)}/approve`);
    return data;
  },

  /** `reason` 5–300 characters; the author sees it with their review. `409 INVALID_REVIEW_STATE` when already rejected. */
  async reject(reviewId, reason) {
    const { data } = await apiClient.post(`/admin/reviews/${encodeURIComponent(reviewId)}/reject`, { reason });
    return data;
  },
};
