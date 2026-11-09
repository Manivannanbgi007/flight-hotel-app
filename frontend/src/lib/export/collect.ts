import { ApiError } from '@/lib/api/apiError';
import type { Page } from '@/lib/api/types';
import { EXPORT_ROW_LIMIT } from './types';

/** One page of the list the screen shows, with the screen's filters, search and sort: (zero-based page, size). */
export type PageFetcher<T> = (page: number, size: number) => Promise<Page<T>>;

export interface CollectOptions<T> {
  /** Rows asked per request; the server may answer with fewer (its own maximum), and its `totalPages` is followed. */
  pageSize?: number;
  limit?: number;
  /** Called after every page: rows so far and the total the server reports. */
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  /** Drops a row seen on an earlier page (rows can move while paging through a live list). */
  key?: (row: T) => string;
  /** Waits before a retry after `429 Too many requests` (ms); a test passes zeros. */
  backoff?: readonly number[];
}

const DEFAULT_BACKOFF = [1_000, 2_000, 4_000, 8_000];

export class ExportTooLargeError extends Error {
  constructor(readonly total: number, readonly limit: number) {
    super(`${total.toLocaleString('en-IN')} rows match: an export holds at most ${limit.toLocaleString('en-IN')}. Narrow the filters and try again.`);
    this.name = 'ExportTooLargeError';
  }
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (ms <= 0) { resolve(); return; }
  const timer = window.setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/**
 * Every row of a paged list, page after page through the same API the screen uses, so the server applies the same
 * filters and the same access rules (a manager only gets their hotels, a customer only their own bookings). Refuses
 * (before loading anything) when more than `limit` rows match.
 */
export async function collectAllRows<T>(fetchPage: PageFetcher<T>, options: CollectOptions<T> = {}): Promise<T[]> {
  const { pageSize = 100, limit = EXPORT_ROW_LIMIT, onProgress, signal, key, backoff = DEFAULT_BACKOFF } = options;
  const rows: T[] = [];
  const seen = key ? new Set<string>() : null;

  const load = async (page: number): Promise<Page<T>> => {
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted();
      try {
        return await fetchPage(page, pageSize);
      } catch (error) {
        const problem = ApiError.from(error);
        if (problem.status !== 429 || attempt >= backoff.length) throw error;
        await wait(backoff[attempt]!, signal);
      }
    }
  };

  let page = 0;
  let totalPages = 1;
  let total = 0;
  while (page < totalPages) {
    const answer = await load(page);
    if (page === 0) {
      total = answer.totalElements;
      if (total > limit) throw new ExportTooLargeError(total, limit);
    }
    totalPages = answer.totalPages;
    for (const row of answer.content) {
      if (seen && key) {
        const id = key(row);
        if (seen.has(id)) continue;
        seen.add(id);
      }
      rows.push(row);
    }
    onProgress?.(rows.length, total);
    if (answer.content.length === 0) break;
    page += 1;
  }
  return rows.slice(0, limit);
}
