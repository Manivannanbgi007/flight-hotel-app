import { useId, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { selectClass } from './fieldStyles';
import { PAGE_SIZES, pageItems, rangeOf } from './paginationItems';

/** The paging part of an API page (`Page<T>` without `content`). */
export interface PageInfo {
  /** Zero-based. */
  page: number;
  /** The page size the server used. */
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface PaginationProps {
  /** The page as the API returned it: pass the whole response (`data`). */
  data: PageInfo;
  onPageChange: (page: number) => void;
  /** Adds the "Rows per page" menu. The caller goes back to the first page with the new size. */
  onPageSizeChange?: (size: number) => void;
  /** The sizes in the menu (default 10, 25, 50, 100); only what the API accepts. */
  pageSizes?: readonly number[];
  /** "booking", "bookings": "21–40 of 927 bookings". Default "result", "results". */
  noun?: readonly [string, string];
  /** The menu's label; "Per page" for lists of cards. */
  sizeLabel?: string;
  /** Adds "Go to page" (a number box) when there are many pages. */
  jump?: boolean;
  className?: string;
}

const PAGE_BUTTON = cn(
  'inline-flex h-9 min-w-9 items-center justify-center rounded-xl px-2 text-sm font-semibold tabular-nums',
  'transition-[background-color,color,box-shadow] duration-(--duration-fast) ease-out-soft',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-600',
);

const STEP_BUTTON = cn(
  PAGE_BUTTON,
  'gap-1 border border-slate-200 bg-white px-2.5 text-slate-700 shadow-xs hover:border-slate-300 hover:bg-slate-50',
  'disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-400 disabled:shadow-none disabled:hover:bg-slate-50',
);

/**
 * Paging under a table or list: "Showing 21–40 of 927 bookings · Page 2 of 47", Previous / Next, the page numbers
 * (first, last and the pages around the current one, with "…" between) and, optionally, "Rows per page".
 *
 * - The current page is filled in the portal colour and has `aria-current="page"`; Previous and Next are disabled at
 *   the ends (not hidden, so nothing moves). "Page 2 of 47" is announced when the page changes.
 * - Phones: one row of compact page numbers with arrow buttons, the summary and the menu above.
 * - Shows nothing for an empty list, and only the summary and menu when everything fits on one page.
 * - Marked `data-assistant-avoid`: the AI assistant's floating button moves out of its way.
 */
export function Pagination({
  data,
  onPageChange,
  onPageSizeChange,
  pageSizes = PAGE_SIZES,
  noun = ['result', 'results'],
  sizeLabel = 'Rows per page',
  jump = false,
  className,
}: PaginationProps) {
  const sizeId = useId();
  const wide = useMediaQuery('(min-width: 640px)');
  const { page, size, totalElements, totalPages } = data;
  const smallest = Math.min(...pageSizes);
  const multiplePages = totalPages > 1;
  // A size menu is worth showing only when a different size would show a different list.
  const showSizes = onPageSizeChange !== undefined && totalElements > smallest;
  if (totalElements <= 0 || (!multiplePages && !showSizes)) {
    return null;
  }

  const { from, to } = rangeOf(page, size, totalElements);
  const items = pageItems(page, totalPages, wide ? 1 : 0);
  const options = pageSizes.includes(size) ? pageSizes : [...pageSizes, size].sort((a, b) => a - b);
  const go = (target: number) => {
    if (target >= 0 && target < totalPages && target !== page) onPageChange(target);
  };

  return (
    <div
      data-assistant-avoid=""
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm animate-fade-up',
        'sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:justify-start">
        <p className="text-sm text-slate-600">
          <span className="max-sm:hidden">Showing </span>
          <span className="font-semibold text-slate-900 tabular-nums">{from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')}</span>
          {' of '}
          <span className="font-semibold text-slate-900 tabular-nums">{totalElements.toLocaleString('en-IN')}</span>
          {` ${totalElements === 1 ? noun[0] : noun[1]}`}
          {multiplePages && (
            <>
              <span aria-hidden="true" className="mx-1.5 text-slate-400">·</span>
              <span aria-live="polite" className="text-slate-500">{`Page ${page + 1} of ${totalPages}`}</span>
            </>
          )}
        </p>
        {showSizes && (
          <div className="flex items-center gap-2">
            <label htmlFor={sizeId} className="text-sm text-slate-600">{sizeLabel}</label>
            <select
              id={sizeId}
              value={size}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className={cn(selectClass(false, { inline: true, size: 'sm' }), 'font-semibold')}
            >
              {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        )}
      </div>

      {multiplePages && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-1 sm:justify-end">
          <button type="button" onClick={() => go(page - 1)} disabled={page === 0} className={STEP_BUTTON}>
            <ChevronLeft className="size-4" aria-hidden="true" />
            <span className="max-sm:sr-only">Previous</span>
          </button>
          <ol className="flex items-center gap-1 rounded-2xl bg-slate-50 p-1 ring-1 ring-inset ring-slate-200/70">
            {items.map((item) =>
              typeof item === 'number' ? (
                <li key={item}>
                  <button
                    type="button"
                    onClick={() => go(item)}
                    aria-label={`Page ${item + 1}`}
                    aria-current={item === page ? 'page' : undefined}
                    className={cn(
                      PAGE_BUTTON,
                      item === page
                        ? 'bg-[linear-gradient(135deg,var(--role-600),var(--role-700))] text-white shadow-md shadow-role-600/30'
                        : 'text-slate-700 hover:bg-white hover:text-role-800 hover:shadow-xs',
                    )}
                  >
                    {(item + 1).toLocaleString('en-IN')}
                  </button>
                </li>
              ) : (
                <li key={item} aria-hidden="true" className="flex h-9 w-6 items-center justify-center text-sm text-slate-400">
                  …
                </li>
              ),
            )}
          </ol>
          <button type="button" onClick={() => go(page + 1)} disabled={page + 1 >= totalPages} className={STEP_BUTTON}>
            <span className="max-sm:sr-only">Next</span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
          {jump && totalPages >= 8 && <JumpToPage totalPages={totalPages} onGo={go} />}
        </nav>
      )}
    </div>
  );
}

/** "Go to page": a number box that jumps when Enter (or Go) is pressed; a number outside 1 to the last page is ignored. */
function JumpToPage({ totalPages, onGo }: { totalPages: number; onGo: (page: number) => void }) {
  const id = useId();
  const [value, setValue] = useState('');
  const submit = () => {
    const target = Number(value);
    if (Number.isInteger(target) && target >= 1 && target <= totalPages) {
      onGo(target - 1);
      setValue('');
    }
  };
  return (
    <form className="ml-2 hidden items-center gap-1.5 border-l border-slate-200 pl-3 lg:flex" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label htmlFor={id} className="text-sm text-slate-600">Go to page</label>
      <input
        id={id}
        type="number"
        min={1}
        max={totalPages}
        inputMode="numeric"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-9 w-16 rounded-xl border border-slate-200 bg-white px-2 text-center text-sm font-semibold tabular-nums shadow-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-role-600"
      />
      <button type="submit" className={cn(STEP_BUTTON, 'px-3')}>Go</button>
    </form>
  );
}
