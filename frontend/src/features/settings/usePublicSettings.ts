import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryKeys';

interface PublicSetting {
  key: string;
  value: string | null;
}

export interface SiteSettings {
  siteName: string;
  supportEmail: string | null;
  supportPhone: string | null;
  currency: string;
}

const FALLBACK: SiteSettings = { siteName: 'FlightHotel', supportEmail: null, supportPhone: null, currency: 'INR' };

async function fetchPublicSettings(): Promise<SiteSettings> {
  const { data } = await apiClient.get<PublicSetting[]>('/public/settings');
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
