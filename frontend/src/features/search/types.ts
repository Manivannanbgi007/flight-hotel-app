import type { Page } from '@/lib/api/types';

/**
 * Global search (search-service behind the gateway, `GET /api/search/suggest` and `GET /api/search`). Both work with or
 * without a login: the server decides from the token what the caller may find, so the UI never sends roles or ids.
 */

export type SearchCategory =
  | 'PAGES' | 'HOTELS' | 'DESTINATIONS' | 'BOOKINGS' | 'PAYMENTS' | 'REFUNDS' | 'USERS' | 'TICKETS' | 'REVIEWS';

/** A category, or every category at once (the results page's "All"). */
export type SearchScope = SearchCategory | 'ALL';

/** A piece of a highlighted text; `match` pieces are shown in `<mark>`. Always plain text, never HTML. */
export interface TextSegment {
  text: string;
  match: boolean;
}

export type SearchTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface SearchResult {
  /** Unique across categories ("BOOKINGS:0193…"). */
  id: string;
  category: SearchCategory;
  title: string;
  /** One short line: a reference, a city, an e-mail. */
  subtitle: string | null;
  /** A longer line for the results page. */
  snippet: string | null;
  /** An app path ("/admin/bookings/…"). Followed only when it starts with "/" (see `isAppPath`). */
  url: string;
  status: { label: string; tone: SearchTone } | null;
  /** Already formatted by the server: `{ label: 'Amount', value: '₹12,400.00' }`. */
  meta: { label: string; value: string }[];
  /** Extra links, e.g. a destination's "Hotels in Chennai" and "Flights to Chennai". */
  actions: { label: string; url: string }[];
  highlight: { title: TextSegment[] | null; subtitle: TextSegment[] | null; snippet: TextSegment[] | null };
}

/** The few best results of one category. `label` is the server's name for it ("My trips" for a customer's bookings). */
export interface ResultGroup {
  category: SearchCategory;
  label: string;
  total: number;
  items: SearchResult[];
}

export interface CategoryCount {
  category: SearchCategory;
  label: string;
  total: number;
}

/** `GET /api/search/suggest?q=`: the header's typeahead (only categories with matches, at most 4 results each). */
export interface SuggestResponse {
  query: string;
  tookMs: number;
  groups: ResultGroup[];
}

/** `GET /api/search?q=&category=&page=&size=`: the results page. */
export interface SearchResponse {
  query: string;
  tookMs: number;
  category: SearchScope;
  /** What the words were understood as ("Cancelled bookings"), shown as a chip. */
  interpretation: string | null;
  /** Every category this user may search, in display order, with its count (0 allowed). */
  categories: CategoryCount[];
  /** ALL: the sum of the counts; a category: its count. */
  total: number;
  /** ALL: up to 5 results of each category with matches; a category: empty. */
  groups: ResultGroup[];
  /** A category: the requested page; ALL: null. */
  results: Page<SearchResult> | null;
}

export interface SearchRequest {
  q: string;
  category?: SearchScope;
  /** Zero-based. */
  page?: number;
  /** 1 to 50. */
  size?: number;
}
