import { AxiosError } from 'axios';

export interface FieldError {
  field: string;
  message: string;
}

/** The backend's RFC 9457 Problem Details body (see common-lib ProblemDetails). */
interface ProblemBody {
  status?: number;
  code?: string;
  detail?: string;
  correlationId?: string | null;
  errors?: FieldError[];
  details?: Record<string, unknown>;
}

/** One error type for the whole UI. `code` is stable and safe to branch on; `message` is safe to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: FieldError[] = [],
    readonly correlationId: string | null = null,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static from(error: unknown): ApiError {
    if (error instanceof ApiError) {
      return error;
    }
    if (error instanceof AxiosError) {
      if (!error.response) {
        return new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
      }
      const body = (error.response.data ?? {}) as ProblemBody;
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

function defaultMessage(status: number): string {
  if (status === 401) return 'Please log in to continue.';
  if (status === 403) return 'You are not allowed to do this.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Too many requests. Please wait a moment.';
  if (status >= 500) return 'Something went wrong on our side. Please try again later.';
  return 'The request could not be completed.';
}
