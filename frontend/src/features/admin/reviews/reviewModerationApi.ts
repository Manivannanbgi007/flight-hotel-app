import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';

/** `/api/admin/reviews` (API_DOCUMENTATION.md §14.4, permission REVIEW_MODERATE). */
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ModerationReview {
  id: string;
  hotelId: string;
  hotelName: string;
  bookingReference: string | null;
  authorName: string;
  rating: number;
  title: string;
  text: string;
  status: ReviewStatus;
  /** "Nov 2026" */
  stayedIn?: string | null;
  reportCount: number;
  reports: { reason: string; createdAt: string }[];
  createdAt: string;
  moderatedAt: string | null;
  rejectionReason: string | null;
}

/** One moderation tab: a status, or the reports that were not reviewed yet. */
export type ReviewQueue = 'PENDING' | 'REPORTED' | 'APPROVED' | 'REJECTED';

export type ReviewFilters = { queue: ReviewQueue; q: string; page: number };

export const reviewModerationApi = {
  async list(filters: ReviewFilters, size = 20): Promise<Page<ModerationReview>> {
    const { data } = await apiClient.get<Page<ModerationReview>>('/admin/reviews', {
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
  async approve(reviewId: string): Promise<ModerationReview> {
    const { data } = await apiClient.post<ModerationReview>(`/admin/reviews/${encodeURIComponent(reviewId)}/approve`);
    return data;
  },

  /** `reason` 5–300 characters; the author sees it with their review. `409 INVALID_REVIEW_STATE` when already rejected. */
  async reject(reviewId: string, reason: string): Promise<ModerationReview> {
    const { data } = await apiClient.post<ModerationReview>(`/admin/reviews/${encodeURIComponent(reviewId)}/reject`, { reason });
    return data;
  },
};
