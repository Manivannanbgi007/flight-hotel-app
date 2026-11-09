import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';

import { ApiError } from '@/lib/api/apiError';
import { AuthProvider } from './AuthProvider';
import { RealtimeProvider } from './RealtimeProvider';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retry network/5xx errors twice; never retry 4xx (the request itself is wrong or not allowed).
        retry: (failureCount, error) => {
          const status = error instanceof ApiError ? error.status : 0;
          return failureCount < 2 && (status === 0 || status >= 500);
        },
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RealtimeProvider>{children}</RealtimeProvider>
      </AuthProvider>
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
