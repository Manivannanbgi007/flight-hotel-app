import { AxiosError } from 'axios';

/** One error type for the whole UI. `code` is stable and safe to branch on; `message` is safe to show. */
export class ApiError extends Error {
  constructor(status, code, message, fieldErrors = [], correlationId = null, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.correlationId = correlationId;
    this.details = details;
    this.name = 'ApiError';
  }

  static from(error) {
    if (error instanceof ApiError) {
      return error;
    }
    if (error instanceof AxiosError) {
      if (!error.response) {
        return new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
      }
      const body = error.response.data ?? {};
      const status = error.response.status;
      return new ApiError(
        status,
        body.code ?? `HTTP_${status}`,
        body.detail ?? defaultMessage(status),
        body.errors ?? [],
        body.correlationId ?? error.response.headers['x-correlation-id'] ?? null,
        body.details ?? {},
      );
    }
    return new ApiError(0, 'UNKNOWN_ERROR', 'Something went wrong. Please try again.');
  }
}

function defaultMessage(status) {
  if (status === 401) return 'Please log in to continue.';
  if (status === 403) return 'You are not allowed to do this.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Too many requests. Please wait a moment.';
  if (status >= 500) return 'Something went wrong on our side. Please try again later.';
  return 'The request could not be completed.';
}
