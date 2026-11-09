import { useContext } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useQuery, type QueryKey } from '@tanstack/react-query';

import { refreshAccessToken } from '@/lib/api/client';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { sessionStore } from '@/lib/auth/sessionStore';
import { realtimeBus } from '@/lib/realtime/eventBus';
import type { ConnectionHandlers, TabCoordinatorOptions } from '@/lib/realtime/tabCoordinator';
import { RESYNC_EVENT, type RealtimeMessage } from '@/lib/realtime/types';
import { customer } from '@/test/renderRoutes';
import { AppProviders } from './AppProviders';
import { RealtimeContext } from './realtimeContext';
import { useRealtimeStatus } from './useRealtime';

/** Stand-ins for the realtime connection: they record what the provider asks of them. */
const fakes = vi.hoisted(() => ({
  coordinators: [] as { options: TabCoordinatorOptions; started: boolean; stopped: boolean }[],
  clients: [] as { options: Record<string, unknown> }[],
}));

vi.mock('@/lib/api/client', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/features/auth/authApi', () => ({ authApi: { logout: vi.fn() } }));
vi.mock('@/lib/realtime/tabCoordinator', () => ({
  TabCoordinator: class {
    started = false;
    stopped = false;
    constructor(readonly options: TabCoordinatorOptions) {
      fakes.coordinators.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.stopped = true;
    }
  },
}));
vi.mock('@/lib/realtime/realtimeClient', () => ({
  RealtimeClient: class {
    constructor(readonly options: Record<string, unknown>) {
      fakes.clients.push(this);
    }
    start() {}
    stop() {}
  },
}));

function QueryProbe({ queryKey, queryFn }: { queryKey: QueryKey; queryFn: () => Promise<unknown> }) {
  const query = useQuery({ queryKey, queryFn });
  return <p>query {query.status}</p>;
}

function RealtimeProbe() {
  const status = useRealtimeStatus();
  const { serverTimeOffsetMs } = useContext(RealtimeContext);
  return <p>live {status}, server clock {Math.round(serverTimeOffsetMs / 1000)}s ahead</p>;
}

const message = (overrides: Partial<RealtimeMessage> = {}): RealtimeMessage => ({
  id: 'm1', type: 'booking.status-changed', resourceType: 'BOOKING', resourceId: 'b1', data: { status: 'CONFIRMED' },
  occurredAt: '2026-11-06T10:00:00Z', ...overrides,
});

const logIn = (id = customer.id, token = 'token-1') =>
  act(() => sessionStore.set({ accessToken: token, user: { ...customer, id } }));

beforeEach(() => {
  fakes.coordinators.length = 0;
  fakes.clients.length = 0;
  vi.mocked(refreshAccessToken).mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  act(() => sessionStore.clear());
});

describe('AppProviders: retrying failed queries', () => {
  it.each([
    ['a 400', new ApiError(400, 'VALIDATION_FAILED', 'Invalid'), 1],
    ['a 403', new ApiError(403, 'FORBIDDEN', 'No'), 1],
    ['a 404', new ApiError(404, 'NOT_FOUND', 'Not found.'), 1],
    ['a 500', new ApiError(500, 'INTERNAL_ERROR', 'Oops'), 3],
    ['a 503', new ApiError(503, 'SERVICE_UNAVAILABLE', 'Busy'), 3],
    ['a network error', new ApiError(0, 'NETWORK_ERROR', 'Offline'), 3],
    ['an unexpected error', new TypeError('bug'), 3],
  ])('tries %s %i time(s) in total', async (_name, error, attempts) => {
    vi.useFakeTimers();
    const queryFn = vi.fn().mockRejectedValue(error);
    render(<AppProviders><QueryProbe queryKey={['probe']} queryFn={queryFn} /></AppProviders>);

    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(queryFn).toHaveBeenCalledTimes(attempts);
    expect(screen.getByText('query error')).toBeInTheDocument();
  });
});

describe('RealtimeProvider', () => {
  it('does not connect while nobody is logged in', async () => {
    render(<AppProviders><RealtimeProbe /></AppProviders>);

    expect(await screen.findByText('live idle, server clock 0s ahead')).toBeInTheDocument();
    expect(fakes.coordinators).toHaveLength(0);
  });

  it('connects for the logged-in user and reports the status and the server clock', async () => {
    render(<AppProviders><RealtimeProbe /></AppProviders>);

    logIn();

    expect(fakes.coordinators).toHaveLength(1);
    const coordinator = fakes.coordinators[0]!;
    expect(coordinator.started).toBe(true);
    const client = coordinator.options.createConnection({} as ConnectionHandlers) as unknown as { options: Record<string, unknown> };
    expect(client.options).toMatchObject({ url: '/api/realtime/stream', refreshAccessToken });
    expect((client.options.getAccessToken as () => string | null)()).toBe('token-1');

    act(() => coordinator.options.onStatusChange('connected'));
    act(() => (client.options.onServerTime as (ms: number) => void)(Date.now() + 5_000));

    expect(await screen.findByText('live connected, server clock 5s ahead')).toBeInTheDocument();
  });

  it('refreshes the data a message is about and passes the message on', async () => {
    const details = vi.fn().mockResolvedValue({ id: 'b1' });
    const other = vi.fn().mockResolvedValue([]);
    const received = vi.fn();
    const unsubscribe = realtimeBus.subscribe('booking.status-changed', received);
    render(
      <AppProviders>
        <QueryProbe queryKey={queryKeys.bookings.detail('b1')} queryFn={details} />
        <QueryProbe queryKey={['unrelated']} queryFn={other} />
      </AppProviders>,
    );
    await waitFor(() => expect(details).toHaveBeenCalledTimes(1));
    logIn();

    act(() => fakes.coordinators[0]!.options.onMessage(message()));

    // Refetched (once per matching rule key: `bookings` and the booking's own keys), unlike unrelated data.
    await waitFor(() => expect(details.mock.calls.length).toBeGreaterThan(1));
    expect(other).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(message());
    unsubscribe();
  });

  it('re-fetches what is on screen after a reconnect and announces the resync', async () => {
    const details = vi.fn().mockResolvedValue({ id: 'b1' });
    const resync = vi.fn();
    const unsubscribe = realtimeBus.subscribe(RESYNC_EVENT, resync);
    render(<AppProviders><QueryProbe queryKey={['anything']} queryFn={details} /></AppProviders>);
    await waitFor(() => expect(details).toHaveBeenCalledTimes(1));
    logIn();

    act(() => fakes.coordinators[0]!.options.onResync());

    await waitFor(() => expect(details).toHaveBeenCalledTimes(2));
    expect(resync).toHaveBeenCalledWith(expect.objectContaining({ type: RESYNC_EVENT, resourceType: 'CLIENT', resourceId: null }));
    unsubscribe();
  });

  it('keeps the connection through token refreshes, closes it on logout and opens a new one for another user', () => {
    render(<AppProviders><RealtimeProbe /></AppProviders>);

    logIn(customer.id, 'token-1');
    logIn(customer.id, 'token-2');
    expect(fakes.coordinators).toHaveLength(1);

    act(() => sessionStore.clear());
    expect(fakes.coordinators[0]!.stopped).toBe(true);

    logIn('someone-else');
    expect(fakes.coordinators).toHaveLength(2);
    expect(fakes.coordinators[1]!.started).toBe(true);
  });
});
