import axios, { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

import { sessionStore } from '@/lib/auth/sessionStore';
import { customer } from '@/test/renderRoutes';
import { ApiError } from './apiError';
import { apiClient, refreshAccessToken } from './client';

const ok = { data: { accessToken: 'new-token', tokenType: 'Bearer', expiresIn: 900, user: customer } } as AxiosResponse;

function httpError(status: number, headers: Record<string, string> = {}): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('failed', 'ERR_BAD_RESPONSE', config, null, {
    status, statusText: '', data: {}, headers, config,
  } as AxiosResponse);
}

const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK', { headers: new AxiosHeaders() });

describe('refreshAccessToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStore.set({ accessToken: 'old-token', user: customer });
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStore.clear();
  });

  it('stores the new session', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(ok);
    await expect(refreshAccessToken()).resolves.toBe(true);
    expect(sessionStore.getAccessToken()).toBe('new-token');
  });

  it('ends the session when the server rejects the cookie', async () => {
    const post = vi.spyOn(axios, 'post').mockRejectedValue(httpError(401));
    await expect(refreshAccessToken()).resolves.toBe(false);
    expect(sessionStore.get()).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('retries when rate limited instead of logging the user out', async () => {
    const post = vi.spyOn(axios, 'post').mockRejectedValueOnce(httpError(429, { 'retry-after': '1' })).mockResolvedValueOnce(ok);

    const result = refreshAccessToken();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
    expect(sessionStore.getAccessToken()).toBe('new-token');
  });

  it('keeps the session through a network outage', async () => {
    const post = vi.spyOn(axios, 'post').mockRejectedValue(networkError());

    const result = refreshAccessToken();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toBe(false);
    expect(post).toHaveBeenCalledTimes(3);
    expect(sessionStore.getAccessToken()).toBe('old-token');
  });

  it('shares one request between concurrent callers', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue(ok);
    const [first, second] = await Promise.all([refreshAccessToken(), refreshAccessToken()]);
    expect(first && second).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('apiClient errors of file downloads', () => {
  it('reads a Problem Details body that arrived as a Blob, so the code and message are kept', async () => {
    const problem = { status: 404, code: 'DOCUMENT_NOT_FOUND', detail: 'Document not found', correlationId: 'corr-1' };
    const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      throw new AxiosError('failed', 'ERR_BAD_REQUEST', config, null, {
        status: 404, statusText: '', headers: {}, config,
        data: new Blob([JSON.stringify(problem)], { type: 'application/problem+json' }),
      } as AxiosResponse);
    };

    const failure = await apiClient.get('/documents/d1/download', { responseType: 'blob', adapter }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 404, code: 'DOCUMENT_NOT_FOUND', message: 'Document not found', correlationId: 'corr-1' });
  });
});

describe('apiClient and the access token', () => {
  /** A fake server: answers 401 to the tokens in `rejected`, 200 otherwise, and records the Authorization headers. */
  function server(rejected: string[]) {
    const seen: (string | null)[] = [];
    const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      const authorization = (config.headers.get('Authorization') as string | undefined) ?? null;
      seen.push(authorization);
      if (rejected.some((token) => authorization === `Bearer ${token}`)) {
        throw new AxiosError('failed', 'ERR_BAD_REQUEST', config, null, {
          status: 401, statusText: '', headers: {}, config, data: { code: 'UNAUTHORIZED', detail: 'Please log in to continue.' },
        } as AxiosResponse);
      }
      return { status: 200, statusText: 'OK', headers: {}, config, data: { ok: true } };
    };
    return { adapter, seen };
  }

  beforeEach(() => sessionStore.set({ accessToken: 'old-token', user: customer }));
  afterEach(() => sessionStore.clear());

  it('sends the access token, unless the call brings its own', async () => {
    const { adapter, seen } = server([]);

    await apiClient.get('/bookings', { adapter });
    await apiClient.get('/bookings', { adapter, headers: { Authorization: 'Bearer special' } });

    expect(seen).toEqual(['Bearer old-token', 'Bearer special']);
  });

  it('sends no token when nobody is logged in', async () => {
    sessionStore.clear();
    const { adapter, seen } = server([]);

    await apiClient.get('/hotels/search', { adapter });

    expect(seen).toEqual([null]);
  });

  it('refreshes an expired token once and repeats the request with the new one', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue(ok);
    const { adapter, seen } = server(['old-token']);

    const response = await apiClient.get('/bookings', { adapter });

    expect(response.data).toEqual({ ok: true });
    expect(seen).toEqual(['Bearer old-token', 'Bearer new-token']);
    expect(post).toHaveBeenCalledTimes(1);
    expect(sessionStore.getAccessToken()).toBe('new-token');
  });

  it('does not loop when the new token is refused too', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue(ok);
    const { adapter, seen } = server(['old-token', 'new-token']);

    const failure = await apiClient.get('/bookings', { adapter }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(seen).toHaveLength(2);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('never refreshes for the login endpoints: a wrong password is just a 401', async () => {
    const post = vi.spyOn(axios, 'post');
    const { adapter } = server(['old-token']);

    const failure = await apiClient.post('/auth/login', { email: 'a@example.com', password: 'wrong' }, { adapter })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 401 });
    expect(post).not.toHaveBeenCalled();
  });

  it('gives up with the original error when the session cannot be refreshed', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(httpError(401));
    const { adapter, seen } = server(['old-token']);

    const failure = await apiClient.get('/bookings', { adapter }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 401, code: 'UNAUTHORIZED', message: 'Please log in to continue.' });
    expect(seen).toHaveLength(1);
    expect(sessionStore.get()).toBeNull();
  });
});
