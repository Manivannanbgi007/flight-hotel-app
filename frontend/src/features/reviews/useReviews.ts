import { useQuery } from '@tanstack/react-query';

import { todayIso } from '@/features/account/schemas';
import { queryKeys } from '@/lib/api/queryKeys';
import { reviewApi } from './reviewApi';

/**
 * My stays that can be reviewed (one cached list for My Trips, the booking page and My reviews). `enabled: false`
 * skips the request when nothing on screen could be reviewable.
 */
export function useEligibleStays(enabled = true) {
  return useQuery({ queryKey: queryKeys.reviews.eligible, queryFn: reviewApi.eligible, enabled, staleTime: 60_000 });
}

/**
 * A hotel stay that might be reviewable: completed, or confirmed and at or past the check-out day. Only decides whether
 * to ask the server; the eligible list is the answer.
 */
export function mayBeReviewable(
  booking: { type: 'HOTEL' | 'FLIGHT'; status: string; endDate: string | null },
  today: string = todayIso(),
): boolean {
  if (booking.type !== 'HOTEL') return false;
  return booking.status === 'COMPLETED' || (booking.status === 'CONFIRMED' && !!booking.endDate && booking.endDate <= today);
}

export const writeReviewPath = (bookingId: string) => `/account/reviews/write/${encodeURIComponent(bookingId)}`;
