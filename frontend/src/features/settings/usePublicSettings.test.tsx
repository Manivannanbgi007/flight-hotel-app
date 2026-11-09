import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';

import { apiClient } from '@/lib/api/client';
import { usePublicSettings } from './usePublicSettings';

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return renderHook(() => usePublicSettings(), { wrapper });
}

describe('usePublicSettings', () => {
  it('reads the brand name and support contacts that admins manage', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [
      { key: 'site.name', value: 'TripNest' },
      { key: 'support.email', value: 'help@tripnest.example' },
      { key: 'support.phone', value: '+91 80 4000 1234' },
      { key: 'currency.default', value: 'INR' },
      { key: 'unrelated.key', value: 'ignored' },
    ] } as AxiosResponse);
    const { result } = renderSettings();

    // Usable at once, before the answer arrives.
    expect(result.current.settings).toEqual({ siteName: 'FlightHotel', supportEmail: null, supportPhone: null, currency: 'INR' });

    await waitFor(() => expect(result.current.settings.siteName).toBe('TripNest'));
    expect(result.current.settings).toEqual({
      siteName: 'TripNest', supportEmail: 'help@tripnest.example', supportPhone: '+91 80 4000 1234', currency: 'INR',
    });
    expect(get).toHaveBeenCalledWith('/public/settings');
  });

  it('falls back to defaults for settings that are missing or empty', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [
      { key: 'site.name', value: null },
      { key: 'support.email', value: null },
    ] } as AxiosResponse);
    const { result } = renderSettings();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.settings).toEqual({ siteName: 'FlightHotel', supportEmail: null, supportPhone: null, currency: 'INR' });
  });

  it('keeps the defaults when the settings cannot be loaded', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('offline'));
    const { result } = renderSettings();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.settings.siteName).toBe('FlightHotel');
  });
});
