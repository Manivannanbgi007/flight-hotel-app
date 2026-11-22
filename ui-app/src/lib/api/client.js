import axios, { isAxiosError } from 'axios';

import { sessionStore } from '@/lib/auth/sessionStore';
import { toSession } from '@/lib/auth/types';
import { ApiError } from './apiError';

/** All API calls go through this instance: same-origin `/api`, bearer token, normalized errors. */
export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 20_000,
  withCredentials: true,
  headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
});

apiClient.interceptors.request.use((config) => {
  const token = sessionStore.getAccessToken();
  if (token && !config.headers.has('Authorization')) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

let refreshInFlight = null;

/** Attempts for a refresh that failed for a temporary reason (network, 429, 5xx). */
const REFRESH_ATTEMPTS = 3;

/**
 * Gets a new session (access token + user) using the HttpOnly refresh cookie. Concurrent callers share one request.
 * Resolves false when no session could be obtained.
 * <p>
 * Only an explicit "no" from the server (401/403) ends the session. A temporary failure (offline, rate limited,
 * server error) is retried briefly and never logs the user out.
 */
export function refreshAccessToken() {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  const generation = sessionStore.generation();
  refreshInFlight = postRefresh()
    .then((response) => {
      // Logged in or out on purpose while this was in flight: that decision wins over this older answer.
      if (sessionStore.generation() !== generation) {
        return sessionStore.get() !== null;
      }
      sessionStore.set(toSession(response.data));
      return true;
    })
    .catch((error) => {
      if (isSessionRejected(error) && sessionStore.generation() === generation) {
        sessionStore.clear();
      }
      return false;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function postRefresh() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await axios.post('/api/auth/refresh', null, {
        withCredentials: true,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
    } catch (error) {
      if (isSessionRejected(error) || attempt >= REFRESH_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(error, attempt)));
    }
  }
}

function isSessionRejected(error) {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  return status === 401 || status === 403;
}

/** Retry-After (seconds, capped at 5 s) when the server sends it, otherwise 0.5 s, 1 s, ... */
function retryDelayMs(error, attempt) {
  const header = isAxiosError(error) ? Number(error.response?.headers?.['retry-after']) : NaN;
  return Number.isFinite(header) && header > 0 ? Math.min(header, 5) * 1000 : 500 * 2 ** (attempt - 1);
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const isAuthCall = config?.url?.startsWith('/auth/') ?? false;
    if (error.response?.status === 401 && config && !config._retried && !isAuthCall && sessionStore.getAccessToken()) {
      config._retried = true;
      if (await refreshAccessToken()) {
        config.headers.set('Authorization', `Bearer ${sessionStore.getAccessToken()}`);
        return apiClient(config);
      }
    }
    await readBlobErrorBody(error);
    throw ApiError.from(error);
  },
);

/**
 * File downloads ask for a Blob (`responseType: 'blob'`), so a Problem Details answer arrives as a Blob too. Read it as
 * JSON, so the error keeps its `code`, message and correlation id instead of a generic "Not found.".
 */
async function readBlobErrorBody(error) {
  const response = error.response;
  if (
    !response ||
    typeof Blob === 'undefined' ||
    !(response.data instanceof Blob) ||
    !/json/i.test(response.data.type)
  ) {
    return;
  }
  try {
    response.data = JSON.parse(await response.data.text());
  } catch {
    // Not readable: the generic message for the status is shown.
  }
}
