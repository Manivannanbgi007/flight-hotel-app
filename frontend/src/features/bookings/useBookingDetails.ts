import { useQuery } from '@tanstack/react-query';

import { usePollingFallback } from '@/app/providers/useRealtime';
import { queryKeys } from '@/lib/api/queryKeys';
import { bookingApi } from './bookingApi';
import { isProcessing } from './status';

/**
 * One booking, kept fresh: live updates refresh it when the server signals a change; while the system is still
 * working on it (room hold, payment confirmation, hotel confirmation) it is also polled every 2 seconds, while a
 * cancellation waits for the hotel or airline every 5 seconds, and every 5 seconds when live updates are not
 * connected, so a lost signal never leaves the customer waiting.
 */
export function useBookingDetails(bookingId: string) {
  const fallback = usePollingFallback(5_000);
  return useQuery({
    queryKey: queryKeys.bookings.detail(bookingId),
    queryFn: () => bookingApi.details(bookingId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && isProcessing(status)) return 2_000;
      return status === 'CANCELLATION_PENDING' ? 5_000 : fallback;
    },
  });
}
