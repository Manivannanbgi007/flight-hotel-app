import { RealtimeClient, type RealtimeClientOptions } from './realtimeClient';
import type { RealtimeStatus } from './types';

/** A fake SSE response whose body the test writes to. */
function sseResponse() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

const connected = 'event: connected\ndata: {"connectionId":"c1","serverTime":"2026-11-02T10:00:00Z"}\n\n';
const bookingMessage =
  'id: m1\nevent: message\ndata: {"id":"m1","type":"booking.status-changed","resourceType":"BOOKING","resourceId":"b1","data":{"status":"CONFIRMED"},"occurredAt":"x"}\n\n';

function setup(overrides: Partial<RealtimeClientOptions> = {}) {
  const statuses: RealtimeStatus[] = [];
  const options: RealtimeClientOptions = {
    url: '/api/realtime/stream',
    getAccessToken: () => 'token-1',
    refreshAccessToken: vi.fn().mockResolvedValue(true),
    onMessage: vi.fn(),
    onStatusChange: (s) => statuses.push(s),
    onResync: vi.fn(),
    random: () => 0.5,
    heartbeatTimeoutMs: 60_000,
    ...overrides,
  };
  return { client: new RealtimeClient(options), options, statuses };
}

/** Lets pending promise callbacks (stream reads) run. */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('RealtimeClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects with the bearer token and delivers messages', async () => {
    const stream = sseResponse();
    const fetchImpl = vi.fn().mockResolvedValue(stream.response);
    const { client, options, statuses } = setup({ fetchImpl });

    client.start();
    await flush();
    stream.push(connected);
    stream.push(bookingMessage);
    await flush();

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token-1', Accept: 'text/event-stream' });
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(options.onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'booking.status-changed', resourceId: 'b1' }));
    expect(options.onResync).not.toHaveBeenCalled();
    client.stop();
  });

  it('reconnects with backoff after the stream ends, sends Last-Event-ID and asks for a resync', async () => {
    const first = sseResponse();
    const second = sseResponse();
    const fetchImpl = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const { client, options, statuses } = setup({ fetchImpl });

    client.start();
    await flush();
    first.push(connected + bookingMessage);
    await flush();
    first.end();
    await flush();
    expect(statuses.at(-1)).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(1_000);
    second.push(connected);
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![1].headers).toMatchObject({ 'Last-Event-ID': 'm1' });
    expect(statuses.at(-1)).toBe('connected');
    expect(options.onResync).toHaveBeenCalledOnce();
    client.stop();
  });

  it('refreshes the token once on 401 and reconnects with the new token', async () => {
    let token = 'expired';
    const stream = sseResponse();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(stream.response);
    const refreshAccessToken = vi.fn().mockImplementation(async () => {
      token = 'fresh';
      return true;
    });
    const { client } = setup({ fetchImpl, refreshAccessToken, getAccessToken: () => token });

    client.start();
    await flush();
    await flush();

    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[1]![1].headers).toMatchObject({ Authorization: 'Bearer fresh' });
    client.stop();
  });

  it('stops when the session cannot be refreshed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const { client, statuses } = setup({ fetchImpl, refreshAccessToken: vi.fn().mockResolvedValue(false) });

    client.start();
    await flush();
    await flush();

    expect(statuses.at(-1)).toBe('idle');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('refreshes and reconnects when the server says the token expired', async () => {
    const first = sseResponse();
    const second = sseResponse();
    const fetchImpl = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const { client, options } = setup({ fetchImpl });

    client.start();
    await flush();
    first.push(connected + 'event: token-expired\ndata: {}\n\n');
    await flush();
    await flush();

    expect(options.refreshAccessToken).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it('reconnects when no heartbeat arrives in time', async () => {
    const first = sseResponse();
    const second = sseResponse();
    const fetchImpl = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const { client, statuses } = setup({ fetchImpl, heartbeatTimeoutMs: 10_000 });

    client.start();
    await flush();
    first.push(connected);
    await flush();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(statuses.at(-1)).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it('waits while offline and reconnects when the network returns', async () => {
    const first = sseResponse();
    const second = sseResponse();
    const fetchImpl = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const { client, statuses } = setup({ fetchImpl });

    client.start();
    await flush();
    first.push(connected);
    await flush();

    window.dispatchEvent(new Event('offline'));
    expect(statuses.at(-1)).toBe('offline');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event('online'));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it('backs off exponentially with a cap when the server keeps failing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const { client } = setup({ fetchImpl, random: () => 0.999, maxBackoffMs: 8_000 });

    client.start();
    await flush();
    // Delays ~1s, 2s, 4s, 8s, 8s (random=0.999 → just under the ceiling).
    for (const delay of [1_000, 2_000, 4_000, 8_000, 8_000]) {
      const calls = fetchImpl.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay);
      expect(fetchImpl.mock.calls.length).toBe(calls + 1);
    }
    client.stop();
  });
});
