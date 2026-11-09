import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { AlertCircle, ArrowRight, History, Loader2, Search, SearchX, Trash2, X } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { areaOfPath } from '@/lib/auth/portals';
import { cn } from '@/lib/cn';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { CategoryIcon } from './CategoryIcon';
import { HighlightedText } from './HighlightedText';
import { searchApi } from './searchApi';
import {
  MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, badgeTone, isAppPath, readRecentSearches, recentSearchesKey, searchResultsPath,
  withRecentSearch, writeRecentSearches,
} from './searchModel';
import type { ResultGroup, SearchResult, SearchScope } from './types';

/** The field's accessible name (the same in every header). */
export const GLOBAL_SEARCH_LABEL = 'Search hotels, flights, bookings and more';
const DEFAULT_PLACEHOLDER = 'Search hotels, flights, bookings and more...';
/** The pause in typing before a request is sent. */
const DEBOUNCE_MS = 250;

/**
 * Where the field sits:
 * - `staff`: the staff shell's header. A field from `md`; below it a search button that opens the field under the header.
 * - `public`: the public header, which also holds the main navigation. A field from `xl`; a button from `md` to `xl`
 *   (phones use the copy in the mobile menu).
 * - `inline`: always a full-width field (the public mobile menu).
 */
export type GlobalSearchVariant = 'staff' | 'public' | 'inline';

const LAYOUT: Record<GlobalSearchVariant, { toggle: string | null; open: string; closed: string; popup: string }> = {
  staff: {
    toggle: 'inline-flex md:hidden',
    open: cn(
      'fixed inset-x-0 top-16 z-40 border-b border-slate-200 bg-white p-3 shadow-lg animate-slide-down',
      'md:static md:z-auto md:block md:w-60 md:max-w-full md:border-0 md:bg-transparent md:p-0 md:shadow-none md:animate-none',
      'transition-[width] duration-(--duration-base) ease-out-soft xl:w-72 xl:focus-within:w-96',
    ),
    // max-w-full: when the header is short of room (e.g. while the sidebar turns into a drawer) the field gives way
    // instead of pushing the account menu out of the window.
    closed: 'hidden transition-[width] duration-(--duration-base) ease-out-soft md:block md:w-60 md:max-w-full xl:w-72 xl:focus-within:w-96',
    popup: 'mt-2 md:absolute md:right-0 md:top-full md:z-50 md:w-[28rem] md:max-w-[calc(100vw-2rem)] xl:w-[34rem]',
  },
  public: {
    toggle: 'hidden md:inline-flex xl:hidden',
    open: cn(
      'fixed inset-x-0 top-16 z-40 border-b border-slate-200 bg-white p-3 shadow-lg animate-slide-down',
      'xl:static xl:z-auto xl:block xl:w-56 xl:max-w-full xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none xl:animate-none 2xl:w-64',
    ),
    closed: 'hidden xl:block xl:w-56 xl:max-w-full 2xl:w-64',
    popup: 'mt-2 xl:absolute xl:right-0 xl:top-full xl:z-50 xl:w-[34rem] xl:max-w-[calc(100vw-2rem)]',
  },
  inline: { toggle: null, open: 'w-full', closed: 'w-full', popup: 'mt-2' },
};

/** One choice of the dropdown (what the arrow keys move through). */
type Option =
  | { kind: 'result'; key: string; result: SearchResult }
  | { kind: 'group'; key: string; group: ResultGroup }
  | { kind: 'all'; key: string }
  | { kind: 'recent'; key: string; term: string }
  | { kind: 'clear'; key: string };

interface Entry {
  option: Option;
  index: number;
}

/**
 * The global search of every header (signed out, customers and every staff portal): one field that finds pages, hotels,
 * destinations, bookings, payments, refunds, users, tickets and reviews: whatever the server lets this user see.
 *
 * - Typing asks `GET /api/search/suggest` after a short pause (from 2 characters); an older request is cancelled, and the
 *   previous list stays until the new one arrives.
 * - The dropdown groups the results by category (icon and name), with the matched words marked, a "See all" per
 *   category with more matches, and "View all results" (the results page of the area the header belongs to).
 * - A focused empty field offers the recent searches (this device, per user).
 * - Keyboard: ↓/↑ move, Enter opens the chosen result (or the results page), Escape closes, Tab leaves; "/" and Ctrl/⌘+K
 *   jump into the field from anywhere. It is an ARIA combobox with a listbox and a live status.
 * - Result urls are app paths from the server; anything that is not one ("https://…", "//host") is never followed.
 */
export function GlobalSearch({ variant = 'staff', placeholder = DEFAULT_PLACEHOLDER, shortcut = true, className }: {
  variant?: GlobalSearchVariant;
  placeholder?: string;
  /** Answer "/" and Ctrl/⌘+K (only one field on a page should). */
  shortcut?: boolean;
  className?: string;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const area = areaOfPath(pathname);
  const viewer = user?.id ?? 'anon';
  const layout = LAYOUT[variant];

  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const panelId = `${baseId}-panel`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [barOpen, setBarOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  // Recent searches of whoever is signed in (re-read when that changes).
  const storageKey = recentSearchesKey(user?.id);
  const [recentState, setRecentState] = useState(() => ({ key: storageKey, items: readRecentSearches(storageKey) }));
  if (recentState.key !== storageKey) {
    setRecentState({ key: storageKey, items: readRecentSearches(storageKey) });
  }
  const recent = recentState.items;
  const saveRecent = (items: string[]) => {
    setRecentState({ key: storageKey, items });
    writeRecentSearches(storageKey, items);
  };

  const trimmed = text.trim();
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS);
  const tooLong = trimmed.length > MAX_QUERY_LENGTH;
  const enough = trimmed.length >= MIN_QUERY_LENGTH && !tooLong;
  const searchable = debounced.length >= MIN_QUERY_LENGTH && debounced.length <= MAX_QUERY_LENGTH;
  // The text is ahead of the debounced words while the person types: that gap counts as searching too.
  const typing = trimmed !== debounced;

  const suggest = useQuery({
    queryKey: queryKeys.search.suggest(debounced, viewer),
    queryFn: ({ signal }) => searchApi.suggest(debounced, signal),
    enabled: searchable,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const groups = enough ? suggest.data?.groups ?? [] : [];
  const loading = enough && (typing || suggest.isFetching);
  const failed = enough && !typing && suggest.isError;
  const settled = enough && !typing && suggest.isSuccess && !suggest.isPlaceholderData;
  const empty = settled && groups.length === 0;
  const signedIn = Boolean(user);

  // The options in the order the arrow keys visit them, and where each one is drawn.
  const options: Option[] = [];
  const add = (option: Option): Entry => {
    options.push(option);
    return { option, index: options.length - 1 };
  };
  const recentEntries: Entry[] = [];
  const groupEntries: { group: ResultGroup; items: Entry[]; more: Entry | null }[] = [];
  let allEntry: Entry | null = null;
  if (trimmed.length === 0) {
    for (const term of recent) recentEntries.push(add({ kind: 'recent', key: `recent:${term}`, term }));
    if (recent.length > 0) recentEntries.push(add({ kind: 'clear', key: 'clear' }));
  } else if (enough) {
    for (const group of groups) {
      const items = group.items.map((result) => add({ kind: 'result', key: `result:${result.id}`, result }));
      const more = group.total > group.items.length ? add({ kind: 'group', key: `group:${group.category}`, group }) : null;
      groupEntries.push({ group, items, more });
    }
    if (!empty) allEntry = add({ kind: 'all', key: 'all' });
  }
  const resultCount = options.filter((option) => option.kind === 'result').length;
  const activeIndex = open && activeKey !== null ? options.findIndex((option) => option.key === activeKey) : -1;
  const activeId = activeIndex >= 0 ? optionId(activeIndex) : undefined;
  const expanded = open && options.length > 0;

  // "/" (outside text fields) and Ctrl/⌘+K jump into the field from anywhere.
  useEffect(() => {
    if (!shortcut) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      const inField = target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
      const slash = event.key === '/' && !inField && !event.ctrlKey && !event.metaKey && !event.altKey;
      const commandK = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k';
      if (!slash && !commandK) return;
      event.preventDefault();
      setBarOpen(true);
      setOpen(true);
      setFocusRequest((count) => count + 1);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shortcut]);

  // Focus after the render that shows the field (on phones it only exists once the bar is open).
  useEffect(() => {
    if (focusRequest === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  // A click anywhere else closes the dropdown (and the bar under the header).
  useEffect(() => {
    if (!open && !barOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setBarOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, barOpen]);

  // The chosen option stays visible in a long list.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const resultsPath = (q: string, category: SearchScope = 'ALL') => searchResultsPath(area, q, category);

  /** Leaves for `path`: the dropdown closes, the field empties, and `remember` joins the recent searches. */
  const go = (path: string, remember: string) => {
    saveRecent(withRecentSearch(recent, remember));
    setOpen(false);
    setBarOpen(false);
    setActiveKey(null);
    setText('');
    inputRef.current?.blur();
    void navigate(path);
  };

  const choose = (option: Option) => {
    if (option.kind === 'result') {
      // Only an app path is followed; anything else opens the results page instead.
      go(isAppPath(option.result.url) ? option.result.url : resultsPath(trimmed), trimmed);
    } else if (option.kind === 'group') {
      go(resultsPath(trimmed, option.group.category), trimmed);
    } else if (option.kind === 'all') {
      go(resultsPath(trimmed), trimmed);
    } else if (option.kind === 'recent') {
      go(resultsPath(option.term), option.term);
    } else {
      saveRecent([]);
      setActiveKey(null);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      const current = open ? activeIndex : -1;
      const next = event.key === 'ArrowDown'
        ? (current + 1) % options.length
        : current <= 0 ? options.length - 1 : current - 1;
      setActiveKey(options[next]!.key);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = activeIndex >= 0 ? options[activeIndex] : undefined;
      if (option) choose(option);
      else if (enough) go(resultsPath(trimmed), trimmed);
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setActiveKey(null);
      } else if (barOpen) {
        event.preventDefault();
        setBarOpen(false);
        toggleRef.current?.focus();
      }
    } else if (event.key === 'Tab') {
      setOpen(false);
      setActiveKey(null);
    }
  };

  /** Focus leaving the whole search (Tab past it) closes it; a click elsewhere is handled by the pointer listener. */
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !event.currentTarget.contains(next)) {
      setOpen(false);
      setBarOpen(false);
      setActiveKey(null);
    }
  };

  const errorMessage = failed ? ApiError.from(suggest.error).message : '';
  let status = '';
  if (open) {
    if (tooLong) status = `Use at most ${MAX_QUERY_LENGTH} characters.`;
    else if (enough) {
      if (loading) status = 'Searching…';
      else if (failed) status = errorMessage;
      else if (empty) status = `No results for “${trimmed}”`;
      else if (settled) status = `${resultCount} ${resultCount === 1 ? 'result' : 'results'}. Use the arrow keys to choose one.`;
    } else if (trimmed.length > 0) status = `Type at least ${MIN_QUERY_LENGTH} characters to search.`;
    else if (recent.length > 0) status = `${recent.length} recent ${recent.length === 1 ? 'search' : 'searches'}`;
  }

  const renderOption = ({ option, index }: Entry, children: ReactNode, className?: string) => {
    const active = index === activeIndex;
    return (
      <div
        key={option.key}
        id={optionId(index)}
        role="option"
        aria-selected={active}
        onMouseMove={() => {
          if (!active) setActiveKey(option.key);
        }}
        onClick={() => choose(option)}
        className={cn(
          'flex items-center gap-3 rounded-xl px-2.5 transition-colors duration-(--duration-fast)',
          active ? 'bg-role-50 ring-1 ring-inset ring-role-200' : 'hover:bg-slate-50',
          className,
        )}
      >
        {children}
      </div>
    );
  };

  const tip = signedIn
    ? 'Try a booking reference, a hotel, a city, an e-mail address or a page.'
    : 'Try a city, a hotel name or a page such as “offers” or “help”.';

  return (
    <div ref={rootRef} onBlur={onBlur} className={cn('relative min-w-0', className)}>
      {layout.toggle && (
        <button
          ref={toggleRef}
          type="button"
          onClick={() => {
            if (barOpen) {
              setBarOpen(false);
              setOpen(false);
            } else {
              setBarOpen(true);
              setOpen(true);
              setFocusRequest((count) => count + 1);
            }
          }}
          aria-label={barOpen ? 'Close search' : 'Open search'}
          aria-expanded={barOpen}
          aria-controls={panelId}
          className={cn(
            'size-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition-colors duration-(--duration-fast) hover:bg-slate-100 hover:text-slate-900',
            layout.toggle,
          )}
        >
          {barOpen ? <X className="size-5" aria-hidden="true" /> : <Search className="size-5" aria-hidden="true" />}
        </button>
      )}

      <div id={panelId} className={barOpen ? layout.open : layout.closed}>
        <div role="search" aria-label="Global search" className="relative">
          <div className="group/field relative">
            <label htmlFor={inputId} className="sr-only">{GLOBAL_SEARCH_LABEL}</label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 transition-colors duration-(--duration-fast) group-focus-within/field:text-role-600"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              id={inputId}
              type="search"
              role="combobox"
              aria-expanded={expanded}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={expanded ? activeId : undefined}
              aria-keyshortcuts={shortcut ? '/ Control+K Meta+K' : undefined}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setActiveKey(null);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              maxLength={100}
              className={cn(
                'peer h-10 w-full truncate rounded-xl border border-slate-200 bg-slate-50 pl-9 text-sm text-slate-900 placeholder:text-slate-500',
                'transition-[background-color,border-color,box-shadow] duration-(--duration-base) ease-out-soft',
                'hover:border-slate-300 focus:border-role-400 focus:bg-white focus:shadow-md focus:ring-4 focus:ring-role-500/15 focus-visible:outline-none',
                '[&::-webkit-search-cancel-button]:hidden',
                text ? 'pr-16' : 'pr-10',
              )}
            />
            {text ? (
              <>
                {loading && (
                  <Loader2 aria-hidden="true" data-testid="search-spinner"
                    className="pointer-events-none absolute right-9 top-1/2 size-4 -translate-y-1/2 animate-spin text-role-600" />
                )}
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setText('');
                    setActiveKey(null);
                    setOpen(true);
                    inputRef.current?.focus();
                  }}
                  className="absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors duration-(--duration-fast) hover:bg-slate-200/70 hover:text-slate-900"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </>
            ) : shortcut && (
              <kbd
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-px font-sans text-[0.6875rem] font-semibold text-slate-500 shadow-xs transition-opacity duration-(--duration-fast) peer-focus:opacity-0 max-md:hidden"
              >
                /
              </kbd>
            )}
          </div>

          <p role="status" aria-live="polite" className="sr-only">{status}</p>

          {open && (
            <div
              // Clicks inside keep the focus in the field (the combobox owns the keyboard).
              onMouseDown={(event) => event.preventDefault()}
              className={cn(
                'max-h-[min(32rem,calc(100dvh-9rem))] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-xl ring-1 ring-slate-900/5 animate-scale-in origin-top',
                layout.popup,
              )}
            >
              {trimmed.length === 0 && recent.length === 0 && (
                <p className="px-2.5 py-2.5 text-sm text-slate-600">
                  <span className="font-semibold text-slate-900">Search everything in one place.</span> {tip}
                </p>
              )}
              {trimmed.length > 0 && !enough && (
                <p className="px-2.5 py-2.5 text-sm text-slate-600">
                  {tooLong ? `Use at most ${MAX_QUERY_LENGTH} characters.` : `Type at least ${MIN_QUERY_LENGTH} characters to search.`}
                </p>
              )}

              {enough && loading && groups.length === 0 && !failed && (
                <div aria-hidden="true" data-testid="search-loading" className="flex flex-col gap-3.5 px-2.5 py-3">
                  {[0, 1, 2].map((row) => (
                    <div key={row} className="flex flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-2/3" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                  ))}
                </div>
              )}
              {failed && (
                <div className="flex items-start gap-2.5 px-2.5 py-3 text-sm">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger-600" aria-hidden="true" />
                  <p className="text-danger-700">{errorMessage}</p>
                </div>
              )}
              {empty && (
                <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
                  <SearchX className="size-8 text-slate-400" aria-hidden="true" />
                  <p className="text-sm font-semibold text-slate-900">No results for “{trimmed}”</p>
                  <p className="max-w-xs text-xs leading-relaxed text-slate-600">
                    {signedIn
                      ? 'Check the spelling or use fewer words. A booking reference or an e-mail address finds a booking.'
                      : 'Check the spelling or use fewer words. Try a city, a hotel name or a page such as “offers”.'}
                  </p>
                </div>
              )}

              {expanded && (
                <div
                  id={listId}
                  role="listbox"
                  aria-label={trimmed.length === 0 ? 'Recent searches' : 'Search suggestions'}
                  aria-busy={loading || undefined}
                  className={cn('transition-opacity duration-(--duration-fast)', loading && groups.length > 0 && 'opacity-70')}
                >
                  {recentEntries.length > 0 && (
                    <div role="presentation" className="px-2.5 pb-1 pt-1.5 text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500">
                      Recent searches
                    </div>
                  )}
                  {recentEntries.map((entry) => (entry.option.kind === 'recent'
                    ? renderOption(entry, (
                      <>
                        <History className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{entry.option.term}</span>
                      </>
                    ), 'py-2')
                    : renderOption(entry, (
                      <>
                        <Trash2 className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
                        <span className="text-sm text-slate-600">Clear recent searches</span>
                      </>
                    ), 'mt-1 py-2')))}

                  {groupEntries.map(({ group, items, more }) => {
                    const headingId = `${baseId}-group-${group.category}`;
                    return (
                      <div key={group.category} role="group" aria-labelledby={headingId} className="mb-1">
                        <div
                          role="presentation"
                          id={headingId}
                          className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500"
                        >
                          <CategoryIcon category={group.category} className="size-3.5 shrink-0 text-role-600" />
                          {group.label}
                        </div>
                        {items.map((entry) => {
                          const result = (entry.option as Extract<Option, { kind: 'result' }>).result;
                          return renderOption(entry, (
                            <>
                              <span className="min-w-0 flex-1">
                                <HighlightedText className="block truncate text-sm font-semibold text-slate-900"
                                  segments={result.highlight?.title} text={result.title} />
                                {result.subtitle && (
                                  <HighlightedText className="block truncate text-xs text-slate-600"
                                    segments={result.highlight?.subtitle} text={result.subtitle} />
                                )}
                              </span>
                              {result.status && <Badge tone={badgeTone(result.status.tone)} className="shrink-0">{result.status.label}</Badge>}
                            </>
                          ), 'py-2');
                        })}
                        {more && renderOption(more, (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-role-700">
                            See all {group.total.toLocaleString('en-IN')} {group.label}
                            <ArrowRight className="size-3.5" aria-hidden="true" />
                          </span>
                        ), 'py-1.5')}
                      </div>
                    );
                  })}

                  {allEntry && (
                    <>
                      {groupEntries.length > 0 && <div role="presentation" className="mx-2.5 my-1 h-px bg-slate-100" />}
                      {renderOption(allEntry, (
                        <>
                          <Search className="size-4 shrink-0 text-role-700" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-role-700">
                            View all results for “{trimmed}”
                          </span>
                          <ArrowRight className="size-4 shrink-0 text-role-700" aria-hidden="true" />
                        </>
                      ), 'py-2.5')}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
