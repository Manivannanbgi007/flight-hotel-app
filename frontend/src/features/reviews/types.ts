import type { Page } from '@/lib/api/types';

/** Hotel reviews (API_DOCUMENTATION.md §14.4, hotel-service). Ratings are whole stars, 1 to 5. */
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type ReviewSort = 'RECENT' | 'HIGHEST' | 'LOWEST';

/** A stay I may review (`GET /api/reviews/eligible`): checked out, or confirmed and past check-out, not reviewed yet. */
export interface EligibleStay {
  bookingId: string;
  bookingReference: string;
  hotelId: string;
  hotelName: string;
  hotelSlug: string | null;
  checkIn: string;
  checkOut: string;
}

export interface CreateReviewBody {
  bookingId: string;
  rating: number;
  title: string;
  text: string;
}

/** One of my reviews (`GET /api/reviews/mine`, `POST /api/reviews`), any status. */
export interface MyReview {
  id: string;
  bookingId?: string | null;
  bookingReference?: string | null;
  hotelId?: string | null;
  hotelName?: string | null;
  hotelSlug?: string | null;
  rating: number;
  title: string;
  text: string;
  status: ReviewStatus;
  /** Set when moderation did not publish it. */
  rejectionReason: string | null;
  createdAt: string;
  moderatedAt?: string | null;
}

/** An approved review as everybody sees it. `authorName` is "Asha R.", `stayedIn` "Nov 2026". */
export interface PublicReview {
  id: string;
  rating: number;
  title: string;
  text: string;
  authorName: string;
  stayedIn: string | null;
  createdAt: string;
}

export interface ReviewSummary {
  /** null when there are no approved reviews yet. */
  average: number | null;
  count: number;
  /** Reviews per star: `{ "5": 10, "4": 3, … }` (missing stars = 0). */
  distribution: Record<string, number>;
}

/** `GET /api/hotels/{idOrSlug}/reviews`: one page of approved reviews plus the hotel's summary. */
export interface HotelReviewsPage extends Page<PublicReview> {
  summary: ReviewSummary;
}

/** Home page: approved reviews with 4 or 5 stars, newest first. */
export interface FeaturedReview extends PublicReview {
  hotelId?: string;
  hotelName: string;
  hotelSlug: string | null;
  city: string | null;
}
