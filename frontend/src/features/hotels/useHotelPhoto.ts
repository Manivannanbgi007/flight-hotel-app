import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/queryKeys';
import { hotelApi } from './hotelApi';
import type { HotelImage } from './types';

/**
 * The hotel's first photo, from its public details (one cached request per hotel, shared with the hotel page). Undefined
 * while it loads, when the hotel has no photo, or when the request fails: callers then show a drawn placeholder.
 */
export function useHotelPhoto(slug: string | null | undefined): HotelImage | undefined {
  const details = useQuery({
    queryKey: queryKeys.hotels.details(slug ?? ''),
    queryFn: () => hotelApi.details(slug!),
    enabled: !!slug,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return details.data?.images?.[0];
}
