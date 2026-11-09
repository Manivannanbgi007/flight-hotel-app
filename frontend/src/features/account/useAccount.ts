import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useAuth } from '@/app/providers/useAuth';
import { queryKeys } from '@/lib/api/queryKeys';
import { accountApi } from './accountApi';

export function useProfile() {
  return useQuery({ queryKey: queryKeys.account.profile, queryFn: accountApi.getProfile });
}

/** The current user's photo as a Blob, or nothing when they have none. */
export function useProfilePhoto() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.account.profilePhoto,
    queryFn: accountApi.getPhoto,
    enabled: !!user?.hasPhoto,
    staleTime: Infinity,
  });
}

export function usePassengers() {
  return useQuery({ queryKey: queryKeys.account.passengers, queryFn: accountApi.listPassengers });
}

export function usePreferences() {
  return useQuery({ queryKey: queryKeys.account.preferences, queryFn: accountApi.getPreferences });
}

export function useLoginHistory(page: number, size = 10) {
  return useQuery({
    queryKey: [...queryKeys.account.loginHistory(page), size],
    queryFn: () => accountApi.loginHistory(page, size),
    placeholderData: keepPreviousData,
  });
}
