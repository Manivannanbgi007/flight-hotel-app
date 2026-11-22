import { CreditCard, FileText, Hotel, LifeBuoy, Luggage, MapPin, RotateCcw, Star, UserRound } from 'lucide-react';

/** Shorter words search nothing (the server answers 400 QUERY_TOO_SHORT); no request is sent for them. */
export const MIN_QUERY_LENGTH = 2;
/** Longer words are refused by the server (400 QUERY_TOO_LONG). */
export const MAX_QUERY_LENGTH = 100;

/** The icon of each category (the dropdown's group headings, the results page's sections and cards). */
export const CATEGORY_ICONS = {
  PAGES: FileText,
  HOTELS: Hotel,
  DESTINATIONS: MapPin,
  BOOKINGS: Luggage,
  PAYMENTS: CreditCard,
  REFUNDS: RotateCcw,
  USERS: UserRound,
  TICKETS: LifeBuoy,
  REVIEWS: Star,
};

export const SEARCH_CATEGORIES = Object.keys(CATEGORY_ICONS);

/** A category the server added later still gets an icon. */
export function categoryIcon(category) {
  return CATEGORY_ICONS[category] ?? FileText;
}

/** `?category=` → a known category, or ALL for anything else. */
export function parseCategory(value) {
  const upper = value?.trim().toUpperCase();
  return upper && SEARCH_CATEGORIES.includes(upper) ? upper : 'ALL';
}

/** The results page of each part of the app: the header's search opens the one of the area it is shown in. */
export const SEARCH_PATHS = {
  customer: '/search',
  admin: '/admin/search',
  support: '/support/search',
  'hotel-manager': '/hotel-manager/search',
};

/** `/admin/search?q=goa&category=HOTELS` */
export function searchResultsPath(area, q, category = 'ALL') {
  const params = new URLSearchParams({ q });
  if (category !== 'ALL') params.set('category', category);
  return `${SEARCH_PATHS[area]}?${params.toString()}`;
}

/**
 * True for an app path the router may open: it starts with one "/" (not "//host" or "/\host", which browsers treat as
 * another site). Result urls come from the server; anything else is never followed.
 */
export function isAppPath(url) {
  return typeof url === 'string' && /^\/(?![/\\])/.test(url);
}

const TONES = ['neutral', 'info', 'success', 'warning', 'danger'];

/** The status badge's tone; a tone the UI does not know is shown neutral. */
export function badgeTone(tone) {
  return TONES.includes(tone) ? tone : 'neutral';
}

/** Highlight pieces that can be shown (plain strings); anything malformed falls back to the plain field. */
export function usableSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  return segments.every(
    (segment) => typeof segment === 'object' && segment !== null && typeof segment.text === 'string',
  )
    ? segments
    : null;
}

// ---- Recent searches (this device, per signed-in user) ----

/** How many recent searches are kept and shown. */
export const MAX_RECENT = 5;

/** One list per user on a shared computer, and one for visitors. */
export function recentSearchesKey(userId) {
  return `fh.search.recent.${userId ?? 'anon'}`;
}

export function readRecentSearches(key) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

export function writeRecentSearches(key, items) {
  try {
    if (items.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(items.slice(0, MAX_RECENT)));
  } catch {
    // Storage blocked (private mode): recent searches are simply not remembered.
  }
}

/** `term` first, without an earlier copy of it (any case), at most MAX_RECENT. */
export function withRecentSearch(items, term) {
  const clean = term.trim();
  if (clean.length < MIN_QUERY_LENGTH) return items;
  return [clean, ...items.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_RECENT);
}
