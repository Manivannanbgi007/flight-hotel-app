import type { Page } from '@/lib/api/types';
import type { CategoryCount, ResultGroup, SearchCategory, SearchResponse, SearchResult, SuggestResponse, TextSegment } from './types';

/** Test data of the global search, shaped like search-service's answers. */

/** `marked('Sea ', ['Goa'], ' resort')`: plain strings, and the matched words in a one-element array. */
export const marked = (...parts: (string | [string])[]): TextSegment[] =>
  parts.map((part) => (typeof part === 'string' ? { text: part, match: false } : { text: part[0], match: true }));

export const result = (
  fields: Pick<SearchResult, 'id' | 'category' | 'title' | 'url'> & Partial<SearchResult>,
): SearchResult => ({
  subtitle: null,
  snippet: null,
  status: null,
  meta: [],
  actions: [],
  highlight: { title: null, subtitle: null, snippet: null },
  ...fields,
});

export const group = (category: SearchCategory, label: string, items: SearchResult[], total = items.length): ResultGroup =>
  ({ category, label, total, items });

export const hotel = result({
  id: 'HOTELS:h1',
  category: 'HOTELS',
  title: 'Sea Breeze Resort',
  subtitle: 'Calangute, Goa',
  snippet: 'A beach resort in North Goa with a pool and sea views.',
  url: '/hotels/sea-breeze-resort',
  status: { label: '4-star', tone: 'info' },
  meta: [{ label: 'From', value: '₹6,300.00' }, { label: 'Rating', value: '4.4' }],
  highlight: { title: null, subtitle: marked('Calangute, ', ['Goa']), snippet: marked('A beach resort in North ', ['Goa'], ' with a pool and sea views.') },
});

export const destination = result({
  id: 'DESTINATIONS:goa',
  category: 'DESTINATIONS',
  title: 'Goa',
  subtitle: 'India · 24 hotels',
  url: '/hotels/search?destination=Goa',
  actions: [
    { label: 'Hotels in Goa', url: '/hotels/search?destination=Goa' },
    { label: 'Flights to Goa', url: '/flights/search?destination=GOI' },
  ],
  highlight: { title: marked(['Goa']), subtitle: null, snippet: null },
});

export const trip = result({
  id: 'BOOKINGS:b1',
  category: 'BOOKINGS',
  title: 'HT-7K3M9Q2X',
  subtitle: 'Sea Breeze Resort · 1–3 Dec 2026',
  url: '/my-trips/b1',
  status: { label: 'Confirmed', tone: 'success' },
  meta: [{ label: 'Amount', value: '₹12,400.00' }],
});

/** The dropdown for "goa": hotels, destinations and the customer's trips (7 in all, 1 shown). */
export const goaSuggestions = (overrides: Partial<SuggestResponse> = {}): SuggestResponse => ({
  query: 'goa',
  tookMs: 12,
  groups: [
    group('HOTELS', 'Hotels', [hotel]),
    group('DESTINATIONS', 'Destinations', [destination]),
    group('BOOKINGS', 'My trips', [trip], 7),
  ],
  ...overrides,
});

export const counts: CategoryCount[] = [
  { category: 'PAGES', label: 'Pages', total: 0 },
  { category: 'HOTELS', label: 'Hotels', total: 3 },
  { category: 'DESTINATIONS', label: 'Destinations', total: 1 },
  { category: 'BOOKINGS', label: 'My trips', total: 7 },
];

export const pageOf = <T>(content: T[], overrides: Partial<Page<T>> = {}): Page<T> => ({
  content, page: 0, size: 10, totalElements: content.length, totalPages: content.length > 0 ? 1 : 0, ...overrides,
});

/** The results page's "All" for "goa". */
export const allResults = (overrides: Partial<SearchResponse> = {}): SearchResponse => ({
  query: 'goa',
  tookMs: 31,
  category: 'ALL',
  interpretation: null,
  categories: counts,
  total: 11,
  groups: [
    group('HOTELS', 'Hotels', [hotel], 3),
    group('DESTINATIONS', 'Destinations', [destination]),
    group('BOOKINGS', 'My trips', [trip], 7),
  ],
  results: null,
  ...overrides,
});

/** One category's page of results. */
export const categoryResults = (category: SearchCategory, items: SearchResult[], page: Partial<Page<SearchResult>> = {}): SearchResponse => ({
  query: 'goa',
  tookMs: 18,
  category,
  interpretation: null,
  categories: counts,
  total: page.totalElements ?? items.length,
  groups: [],
  results: pageOf(items, page),
});
