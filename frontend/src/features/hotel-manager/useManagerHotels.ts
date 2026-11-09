import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/queryKeys';
import { managerApi } from './managerApi';

/** The hotels the current user manages (admins: all hotels). */
export function useManagerHotels() {
  return useQuery({ queryKey: queryKeys.hotelManager.hotels, queryFn: managerApi.myHotels });
}
