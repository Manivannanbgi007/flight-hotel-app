import { ApiError } from '@/lib/api/apiError';

import { EXPORT_ROW_LIMIT } from './types';

const DEFAULT_BACKOFF = [1_000, 2_000, 4_000, 8_000];

export class ExportTooLargeError extends Error {
  constructor(total, limit) {
    super(
      `${total.toLocaleString('en-IN')} rows match: an export holds at most ${limit.toLocaleString('en-IN')}. Narrow the filters and try again.`,
    );
    this.total = total;
    this.limit = limit;
    this.name = 'ExportTooLargeError';
  }
}

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * Every row of a paged list, page after page through the same API the screen uses, so the server applies the same
 * filters and the same access rules (a manager only gets their hotels, a customer only their own bookings). Refuses
 * (before loading anything) when more than `limit` rows match.
 */
export async function collectAllRows(fetchPage, options = {}) {
  const { pageSize = 100, limit = EXPORT_ROW_LIMIT, onProgress, signal, key, backoff = DEFAULT_BACKOFF } = options;
  const rows = [];
  const seen = key ? new Set() : null;

  const load = async (page) => {
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted();
      try {
        return await fetchPage(page, pageSize);
      } catch (error) {
        const problem = ApiError.from(error);
        if (problem.status !== 429 || attempt >= backoff.length) throw error;
        await wait(backoff[attempt], signal);
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
