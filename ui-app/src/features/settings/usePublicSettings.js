import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryKeys';

const FALLBACK = { siteName: 'FlightHotel', supportEmail: null, supportPhone: null, currency: 'INR' };

async function fetchPublicSettings() {
  const { data } = await apiClient.get('/public/settings');
  const byKey = new Map(data.map((setting) => [setting.key, setting.value]));
  return {
    siteName: byKey.get('site.name') ?? FALLBACK.siteName,
    supportEmail: byKey.get('support.email') ?? null,
    supportPhone: byKey.get('support.phone') ?? null,
    currency: byKey.get('currency.default') ?? FALLBACK.currency,
  };
}

/** Brand name and support contacts managed by admins in System Settings (reporting-service). */
export function usePublicSettings() {
  const query = useQuery({
    queryKey: queryKeys.publicSettings,
    queryFn: fetchPublicSettings,
    staleTime: 5 * 60_000,
  });
  return { ...query, settings: query.data ?? FALLBACK };
}
