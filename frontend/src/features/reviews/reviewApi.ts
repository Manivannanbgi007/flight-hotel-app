import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';
import type {
  CreateReviewBody,
  EligibleStay,
  FeaturedReview,
  HotelReviewsPage,
  MyReview,
  PublicReview,
  ReviewSort,
  ReviewSummary,
} from './types';

const EMPTY_SUMMARY: ReviewSummary = { average: null, count: 0, distribution: {} };

/** A list the contract does not say is paged: accept both a plain array and a page. */
function listOf<T>(data: T[] | Partial<Page<T>> | null | undefined): T[] {
  if (Array.isArray(data)) return data;
  return data?.content ?? [];
}

/** `/api/reviews` and the public hotel reviews (API_DOCUMENTATION.md §14.4). */
export const reviewApi = {
  /** My stays that can be reviewed now. */
  async eligible(): Promise<EligibleStay[]> {
    const { data } = await apiClient.get<EligibleStay[] | Page<EligibleStay>>('/reviews/eligible');
    return listOf(data);
  },

  /** `201` with status PENDING. `422 NOT_ELIGIBLE`, `409 ALREADY_REVIEWED`. */
  async create(body: CreateReviewBody): Promise<MyReview> {
    const { data } = await apiClient.post<MyReview>('/reviews', body);
    return data;
  },

  /** My reviews, any status, with the rejection reason. */
  async mine(): Promise<MyReview[]> {
    const { data } = await apiClient.get<MyReview[] | Page<MyReview>>('/reviews/mine', { params: { size: 100 } });
    return listOf(data);
  },

  /** Once per user (`409 ALREADY_REPORTED`), never my own review (`422 OWN_REVIEW`). */
  async report(reviewId: string, reason: string): Promise<void> {
    await apiClient.post(`/reviews/${encodeURIComponent(reviewId)}/report`, { reason });
  },

  /** Public: approved reviews of one hotel, plus the summary (average, count, stars). */
  async forHotel(idOrSlug: string, query: { page: number; size: number; sort: ReviewSort }): Promise<HotelReviewsPage> {
    const { data } = await apiClient.get<Partial<HotelReviewsPage> & { reviews?: Page<PublicReview> }>(
      `/hotels/${encodeURIComponent(idOrSlug)}/reviews`,
      { params: query },
    );
    // The page may come flat or nested under `reviews`; the summary next to it.
    const page = data.content ? data : data.reviews;
    return {
      content: page?.content ?? [],
      page: page?.page ?? query.page,
      size: page?.size ?? query.size,
      totalElements: page?.totalElements ?? 0,
      totalPages: page?.totalPages ?? 0,
      summary: data.summary ?? EMPTY_SUMMARY,
    };
  },

  /** Public: recent 4 and 5 star reviews for the home page. */
  async featured(limit = 6): Promise<FeaturedReview[]> {
    const { data } = await apiClient.get<FeaturedReview[] | Page<FeaturedReview>>('/reviews/featured', { params: { limit } });
    return listOf(data);
  },
};
