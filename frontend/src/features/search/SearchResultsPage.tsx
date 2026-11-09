import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ArrowRight, CheckCircle2, Search, Sparkles, X } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES_UP_TO_50, readPageSize } from '@/components/ui/paginationItems';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { areaOfPath, portalOfArea } from '@/lib/auth/portals';
import { cn } from '@/lib/cn';
import { CategoryIcon } from './CategoryIcon';
import { HighlightedText } from './HighlightedText';
import { searchApi } from './searchApi';
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, badgeTone, isAppPath, parseCategory } from './searchModel';
import type { ResultGroup, SearchResult, SearchScope } from './types';

/** Results per page of one category unless `?size=` asks for another (the API allows at most 50). */
const DEFAULT_PAGE_SIZE = 10;

const PLACEHOLDER = 'Search hotels, flights, bookings and more...';

/** "0.03": the server's search time in seconds (never "0.00"). */
function seconds(tookMs: number): string {
  return Number.isFinite(tookMs) ? Math.max(0.01, tookMs / 1000).toFixed(2) : '0.01';
}

/**
 * The global search's results page: `/search` (public layout, also signed out), `/admin/search`, `/support/search` and
 * `/hotel-manager/search` (the staff shells). Everything is in the URL (`?q=&category=&page=&size=`), so the back button
 * and shared links work.
 *
 * - "All" shows the best results of each category, with "See all" opening that category; a category shows its results
 *   page by page.
 * - The tabs are the categories the server lets this user search, with their counts; "12 results (0.03 s)" and what the
 *   words were understood as ("Cancelled bookings") sit above them.
 * - Fewer than 2 characters send no request; the page asks for more instead.
 */
export function SearchResultsPage() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const area = areaOfPath(pathname);
  const q = (params.get('q') ?? '').trim();
  const category = parseCategory(params.get('category'));
  const page = Math.max(0, Math.floor(Number(params.get('page') ?? 0)) || 0);
  const size = readPageSize(params, PAGE_SIZES_UP_TO_50, DEFAULT_PAGE_SIZE);
  const tooShort = q.length < MIN_QUERY_LENGTH;
  const tooLong = q.length > MAX_QUERY_LENGTH;
  const request = { q, category, page: category === 'ALL' ? 0 : page, size };

  const search = useQuery({
    queryKey: queryKeys.search.results(request, user?.id ?? 'anon'),
    queryFn: ({ signal }) => searchApi.search(request, signal),
    enabled: !tooShort && !tooLong,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  /** A new search, category or page size starts again on the first page. */
  const update = (next: { q?: string; page?: number; size?: number }) => {
    const updated = new URLSearchParams(params);
    if (next.q !== undefined) updated.set('q', next.q);
    if (next.size !== undefined) {
      if (next.size === DEFAULT_PAGE_SIZE) updated.delete('size');
      else updated.set('size', String(next.size));
    }
    if (next.page !== undefined && next.page > 0) updated.set('page', String(next.page));
    else updated.delete('page');
    setParams(updated);
  };

  const categoryHref = (value: SearchScope) => {
    const updated = new URLSearchParams(params);
    updated.delete('page');
    if (value === 'ALL') updated.delete('category');
    else updated.set('category', value);
    return `${pathname}?${updated.toString()}`;
  };

  const data = search.data;
  // While another category loads, the previous answer only keeps the counts on screen.
  const current = data && data.category === category ? data : undefined;
  const allCount = data ? data.categories.reduce((sum, item) => sum + item.total, 0) : 0;
  const categoryLabel = data?.categories.find((item) => item.category === category)?.label ?? 'results';
  const signedIn = Boolean(user);

  let body: ReactNode;
  if (search.isError) {
    const problem = ApiError.from(search.error);
    body = (
      <ErrorState
        title="The search could not be completed"
        description={problem.message}
        correlationId={problem.correlationId}
        onRetry={() => void search.refetch()}
      />
    );
  } else if (!current) {
    body = <ResultsLoading />;
  } else if (current.category === 'ALL') {
    body = current.groups.length === 0
      ? <NoResults q={q} signedIn={signedIn} />
      : (
        <div className="flex flex-col gap-10">
          {current.groups.map((group) => <GroupSection key={group.category} group={group} seeAllHref={categoryHref(group.category)} />)}
        </div>
      );
  } else {
    const results = current.results;
    if (!results || results.content.length === 0) {
      body = current.total > 0 ? (
        <EmptyState
          compact
          illustration="search"
          title="This page is empty"
          description={`There are ${current.total.toLocaleString('en-IN')} results; this page is past the last one.`}
          action={<Button variant="secondary" size="sm" onClick={() => update({ page: 0 })}>Go to the first page</Button>}
        />
      ) : allCount > 0 ? (
        <EmptyState
          compact
          illustration="search"
          title={`No results in ${categoryLabel} for “${q}”`}
          description="Other categories have results."
          action={<ButtonLink to={categoryHref('ALL')} variant="secondary" size="sm">Show all results</ButtonLink>}
        />
      ) : <NoResults q={q} signedIn={signedIn} />;
    } else {
      body = (
        <section aria-labelledby="search-category-results">
          <h2 id="search-category-results" className="sr-only">{categoryLabel}</h2>
          <ul className="flex flex-col gap-3">
            {results.content.map((result) => <li key={result.id}><ResultCard result={result} /></li>)}
          </ul>
          <Pagination
            data={results}
            onPageChange={(next) => update({ page: next })}
            onPageSizeChange={(next) => update({ size: next })}
            pageSizes={PAGE_SIZES_UP_TO_50}
            noun={['result', 'results']}
            sizeLabel="Per page"
            className="mt-6"
          />
        </section>
      );
    }
  }

  const content = (
    <>
      <PageHeader
        eyebrow={area === 'customer' ? 'Search' : portalOfArea(area).label}
        title="Search results"
        icon={<Search className="size-5" />}
        description={q
          ? <>What we found for <span className="font-semibold text-slate-900">“{q}”</span></>
          : 'Find hotels, destinations, bookings, payments, support tickets and pages in one place.'}
      />

      <ResultsSearchForm key={q} q={q} onSubmit={(value) => update({ q: value })} />

      {tooShort || tooLong ? (
        <EmptyState
          className="mt-6"
          illustration="search"
          title={tooLong ? 'That is a long search' : q ? 'Type a little more' : 'What are you looking for?'}
          description={tooLong
            ? `Use at most ${MAX_QUERY_LENGTH} characters.`
            : `Type at least ${MIN_QUERY_LENGTH} characters: a hotel, a city, a booking reference, an e-mail address or a page.`}
        />
      ) : (
        <>
          {data ? (
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="text-sm text-slate-600">
                <span className="font-semibold tabular-nums text-slate-900">{data.total.toLocaleString('en-IN')}</span>
                {` ${data.total === 1 ? 'result' : 'results'} (${seconds(data.tookMs)} s)`}
              </p>
              {data.interpretation && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-role-50 px-3 py-1 text-xs font-semibold text-role-800 ring-1 ring-inset ring-role-200">
                  <Sparkles className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Understood as: </span>
                  {data.interpretation}
                </span>
              )}
            </div>
          ) : !search.isError && (
            <div aria-hidden="true" className="mt-5 flex flex-col gap-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-9 w-full max-w-lg rounded-full" />
            </div>
          )}

          {data && (
            <nav aria-label="Result categories" className="mt-4">
              <ul className="flex flex-wrap gap-2">
                <li>
                  <CategoryPill to={categoryHref('ALL')} label="All" count={allCount} selected={category === 'ALL'} />
                </li>
                {data.categories.map((item) => (
                  <li key={item.category}>
                    <CategoryPill to={categoryHref(item.category)} label={item.label} count={item.total} selected={category === item.category}
                      category={item.category} />
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div
            aria-busy={search.isFetching || undefined}
            className={cn('mt-6 transition-opacity duration-(--duration-base)', search.isPlaceholderData && current && 'opacity-60')}
          >
            {body}
          </div>
        </>
      )}
    </>
  );

  return area === 'customer' ? <PageContainer width="lg">{content}</PageContainer> : <div className="flex flex-col">{content}</div>;
}

/** The search field of the page: shows the words searched, and a new search replaces them in the URL. */
function ResultsSearchForm({ q, onSubmit }: { q: string; onSubmit: (q: string) => void }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(q);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (value) onSubmit(value);
  };
  return (
    <form role="search" aria-label="Search" onSubmit={submit} className="group/field relative mt-6 max-w-3xl">
      <label htmlFor={inputId} className="sr-only">Search</label>
      <Search
        className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400 transition-colors duration-(--duration-fast) group-focus-within/field:text-role-600"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={PLACEHOLDER}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={100}
        className={cn(
          'h-12 w-full rounded-2xl border border-slate-200 bg-white pl-12 text-base text-slate-900 shadow-sm placeholder:text-slate-500',
          'transition-[border-color,box-shadow] duration-(--duration-base) ease-out-soft hover:border-slate-300',
          'focus:border-role-400 focus:shadow-md focus:ring-4 focus:ring-role-500/15 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden',
          text ? 'pr-32' : 'pr-24',
        )}
      />
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setText('');
            inputRef.current?.focus();
          }}
          className="absolute right-[5.75rem] top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
      <Button type="submit" size="sm" className="absolute right-2 top-1/2 -translate-y-1/2">Search</Button>
    </form>
  );
}

/** A category tab: a link (each category is its own URL), with its count. */
function CategoryPill({ to, label, count, selected, category }: {
  to: string;
  label: string;
  count: number;
  selected: boolean;
  /** Its icon (none for "All"). */
  category?: string;
}) {
  return (
    <Link
      to={to}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-[background-color,color,box-shadow] duration-(--duration-fast)',
        selected
          ? 'bg-[linear-gradient(135deg,var(--role-600),var(--role-700))] text-white shadow-md shadow-role-600/25'
          : 'bg-white text-slate-700 shadow-xs ring-1 ring-inset ring-slate-200 hover:text-role-800 hover:ring-role-300',
      )}
    >
      {category && <CategoryIcon category={category} className="size-4" />}
      {label}
      <span className={cn('rounded-full px-1.5 text-xs tabular-nums', selected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700')}>
        {count.toLocaleString('en-IN')}
        <span className="sr-only"> results</span>
      </span>
    </Link>
  );
}

/** One category of "All": its heading with the count, its best results, and "See all" when there are more. */
function GroupSection({ group, seeAllHref }: { group: ResultGroup; seeAllHref: string }) {
  const headingId = useId();
  const total = group.total.toLocaleString('en-IN');
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900">
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-role-50 ring-1 ring-inset ring-role-100">
            <CategoryIcon category={group.category} className="size-[1.125rem] text-role-700" />
          </span>
          {group.label}
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700 ring-1 ring-inset ring-slate-200">
            {total}
            <span className="sr-only"> results</span>
          </span>
        </h2>
        {group.total > group.items.length && (
          <Link to={seeAllHref} className="inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-role-700 hover:underline">
            See all {total} {group.label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {group.items.map((result) => <li key={result.id}><ResultCard result={result} /></li>)}
      </ul>
    </section>
  );
}

/**
 * One result: the category's icon, the title (with the matched words marked) linking to the result, the subtitle, the
 * snippet, the status, the details and the extra links. The whole card opens the result; only app paths are linked.
 */
function ResultCard({ result }: { result: SearchResult }) {
  const title = <HighlightedText segments={result.highlight?.title} text={result.title} />;
  const meta = result.meta ?? [];
  const actions = (result.actions ?? []).filter((action) => isAppPath(action.url));
  return (
    <article className="group relative flex gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card transition-[border-color,box-shadow] duration-(--duration-fast) hover:border-role-200 hover:shadow-md sm:p-5">
      <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-role-50 ring-1 ring-inset ring-role-100">
        <CategoryIcon category={result.category} className="size-5 text-role-700" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <h3 className="min-w-0 break-words text-base font-bold text-slate-900">
            {isAppPath(result.url) ? (
              <Link
                to={result.url}
                className="rounded-sm transition-colors duration-(--duration-fast) after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:text-role-700 group-hover:text-role-700 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-role-600"
              >
                {title}
              </Link>
            ) : title}
          </h3>
          {result.status && <Badge tone={badgeTone(result.status.tone)} className="shrink-0">{result.status.label}</Badge>}
        </div>
        {result.subtitle && (
          <p className="mt-0.5 break-words text-sm text-slate-600">
            <HighlightedText segments={result.highlight?.subtitle} text={result.subtitle} />
          </p>
        )}
        {result.snippet && (
          <p className="mt-2 line-clamp-2 break-words text-sm leading-relaxed text-slate-700">
            <HighlightedText segments={result.highlight?.snippet} text={result.snippet} />
          </p>
        )}
        {meta.length > 0 && (
          <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
            {meta.map((item, index) => (
              <div key={`${item.label}-${index}`} className="flex items-baseline gap-1.5">
                <dt className="text-slate-600">{item.label}</dt>
                <dd className="font-semibold text-slate-900">{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {actions.length > 0 && (
          <ul aria-label={`More for ${result.title}`} className="relative z-10 mt-3 flex flex-wrap gap-2">
            {actions.map((action) => (
              <li key={`${action.label}-${action.url}`}>
                <Link
                  to={action.url}
                  className="inline-flex items-center gap-1 rounded-full bg-role-50 px-3 py-1 text-xs font-semibold text-role-800 ring-1 ring-inset ring-role-200 transition-colors duration-(--duration-fast) hover:bg-role-100"
                >
                  {action.label}
                  <ArrowRight className="size-3" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function NoResults({ q, signedIn }: { q: string; signedIn: boolean }) {
  const tips = [
    'Check the spelling.',
    'Use fewer or more general words.',
    signedIn ? 'Try a booking reference (HT-…, FL-…) or an e-mail address.' : 'Try a city or a hotel name.',
  ];
  return (
    <EmptyState
      illustration="search"
      title={`No results for “${q}”`}
      description={signedIn ? 'Nothing you have access to matches these words.' : 'Nothing matches these words.'}
      action={(
        <ul className="flex flex-col gap-1.5 text-left text-sm text-slate-700">
          {tips.map((tip) => (
            <li key={tip} className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0 text-success-600" aria-hidden="true" />
              {tip}
            </li>
          ))}
        </ul>
      )}
    />
  );
}

function ResultsLoading() {
  return (
    <div className="flex flex-col gap-3">
      <span role="status" className="sr-only">Searching…</span>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
          <Skeleton className="size-11 shrink-0 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3.5 w-1/4" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
