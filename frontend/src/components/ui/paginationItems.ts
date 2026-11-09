/** One slot of a page list: a zero-based page number, or a gap ("…"). */
export type PageItem = number | 'gap-start' | 'gap-end';

/** The page sizes a table offers (rows per page). Lists whose API allows at most 50 pass `PAGE_SIZES_UP_TO_50`. */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const PAGE_SIZES_UP_TO_50 = [10, 25, 50] as const;

/**
 * The pages to show for `page` (zero-based) of `totalPages`: always the first and the last, `siblings` on each side of
 * the current one, and a gap where pages are left out. The number of slots stays the same while paging (no jumping
 * buttons): `2 * siblings + 5` once there are more pages than that.
 *
 * 10 pages, page 5, one sibling: 1 … 5 6 7 … 10 (as zero-based numbers: 0, gap, 4, 5, 6, gap, 9).
 */
export function pageItems(page: number, totalPages: number, siblings = 1): PageItem[] {
  if (totalPages <= 0) return [];
  const slots = 2 * siblings + 5;
  if (totalPages <= slots) {
    return Array.from({ length: totalPages }, (_, index) => index);
  }
  const last = totalPages - 1;
  const current = Math.min(Math.max(page, 0), last);
  // The window around the current page, kept away from the first and last page and shifted at the ends so the
  // number of slots does not change.
  const windowStart = Math.max(Math.min(current - siblings, last - 1 - 2 * siblings - 1), 2);
  const windowEnd = Math.min(Math.max(current + siblings, 2 * siblings + 2), last - 2);
  const items: PageItem[] = [0];
  items.push(windowStart > 2 ? 'gap-start' : 1);
  for (let index = windowStart; index <= windowEnd; index += 1) items.push(index);
  items.push(windowEnd < last - 2 ? 'gap-end' : last - 1);
  items.push(last);
  return items;
}

/** "21–40" of a page of `size` rows (zero-based `page`); "0" when there is nothing. */
export function rangeOf(page: number, size: number, totalElements: number): { from: number; to: number } {
  if (totalElements <= 0 || size <= 0) return { from: 0, to: 0 };
  const from = Math.min(page * size + 1, totalElements);
  return { from, to: Math.min((page + 1) * size, totalElements) };
}

/**
 * The page size from `?size=` when it is one of `sizes`, otherwise `fallback` (a link with `size=1000` cannot load more
 * than the table offers).
 */
export function readPageSize(params: URLSearchParams, sizes: readonly number[], fallback: number): number {
  const value = Number(params.get('size'));
  return sizes.includes(value) ? value : fallback;
}
