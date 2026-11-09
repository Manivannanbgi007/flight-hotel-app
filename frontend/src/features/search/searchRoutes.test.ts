/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchRoutes } from 'react-router';

import { routes } from '@/app/router';
import { REPORTS } from '@/features/admin/reports/reports';
import { SEARCH_PATHS } from './searchModel';

/**
 * Every url the search can return must open a real page of the app. search-service builds result urls from the
 * patterns of its API contract and serves the pages of `pages.json`; a renamed route would otherwise send people to the
 * "page not found" page (or to a portal's "under construction" catch-all) without any test noticing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGES_JSON = path.resolve(here, '../../../../services/search-service/src/main/resources/search/pages.json');

const HOTEL_ID = '0193a8c2-5d1e-7f00-9a6b-2c4d5e6f7a8b';
const ID = '0193a8c2-5d1e-7f00-9a6b-000000000001';

/** The url patterns of the search API contract, with sample values. */
const CONTRACT_URLS = [
  '/hotels/sea-breeze-resort-goa',
  '/hotels/search?destination=Chennai',
  '/flights/search?destination=MAA',
  `/admin/bookings/${ID}`,
  `/admin/payments/${ID}`,
  `/admin/users/${ID}`,
  '/admin/refunds?q=HT-7K3M9Q2X',
  '/admin/reviews?q=HT-7K3M9Q2X',
  '/admin/hotels?q=Sea%20Breeze',
  `/support/bookings/${ID}`,
  '/support/bookings?q=asha%40example.com',
  `/support/tickets/${ID}`,
  `/my-trips/${ID}`,
  '/account/payments?q=HT-7K3M9Q2X',
  '/account/payments',
  `/account/support/${ID}`,
  '/account/reviews',
  `/hotel-manager/hotels/${HOTEL_ID}/dashboard`,
  `/hotel-manager/hotels/${HOTEL_ID}/reservations/${ID}`,
  `/hotel-manager/hotels/${HOTEL_ID}/reservations?q=HT-7K3M9Q2X`,
  `/hotel-manager/hotels/${HOTEL_ID}/reviews`,
];

interface CataloguePage {
  id: string;
  url: string;
  perHotel?: boolean;
}

function catalogueUrls(): { id: string; url: string }[] {
  const { pages } = JSON.parse(readFileSync(PAGES_JSON, 'utf-8')) as { pages: CataloguePage[] };
  return pages.map((page) => ({ id: page.id, url: page.url.replaceAll('{hotelId}', HOTEL_ID) }));
}

/** Why `url` does not open a real page, or null when it does. */
function problemWith(url: string): string | null {
  if (!url.startsWith('/') || url.startsWith('//')) return 'is not an app path';
  const pathname = new URL(url, 'https://app.example').pathname;
  const matches = matchRoutes(routes, pathname);
  const page = matches?.[matches.length - 1];
  if (!page) return 'matches no route';
  if (page.route.path === '*' || page.route.path?.endsWith('/*')) return 'only matches a catch-all route';
  if (page.route.path === 'reports/:report' && !REPORTS.some((report) => report.key === page.params.report)) {
    return `names an unknown report "${page.params.report}"`;
  }
  return null;
}

describe('search result urls', () => {
  it('reads the page catalogue of search-service', () => {
    expect(catalogueUrls().length).toBeGreaterThan(40);
  });

  it('every page of pages.json opens a real route', () => {
    const problems = catalogueUrls()
      .map(({ id, url }) => ({ id, url, problem: problemWith(url) }))
      .filter(({ problem }) => problem !== null);

    expect(problems).toEqual([]);
  });

  it.each(CONTRACT_URLS)('%s (a url pattern of the API contract) opens a real route', (url) => {
    expect(problemWith(url)).toBeNull();
  });

  it.each(Object.values(SEARCH_PATHS))('the results page %s is a real route', (url) => {
    expect(problemWith(`${url}?q=goa`)).toBeNull();
  });

  it('notices urls that only reach "page not found"', () => {
    expect(problemWith('/no-such-page')).toBe('only matches a catch-all route');
    expect(problemWith('/admin/no-such-page')).toBe('only matches a catch-all route');
    expect(problemWith('/support/no-such-page')).toBe('only matches a catch-all route');
    expect(problemWith('/admin/reports/no-such-report')).toBe('names an unknown report "no-such-report"');
    expect(problemWith('https://evil.example/')).toBe('is not an app path');
  });
});
