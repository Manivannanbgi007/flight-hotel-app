import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

import { logIn, SIGN_IN } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';
import { API_URL, BASE_URL, DEMO_ACCOUNTS, demoPassword } from './support/env';
import { isoDate } from './support/wait';

/**
 * The three staff portals (IMPLEMENTATION_PLAN.md Phase 11, §11.1–11.3) with the demo accounts:
 * - each role signs in at its own page and lands on its dashboard;
 * - the dashboard's key figures equal the API's answer for the same session and range (nothing is hard-coded);
 * - the range and interval filters change the request (and the URL);
 * - phone width: no sideways scrolling, the navigation drawer works;
 * - axe: 0 serious or critical issues on each dashboard and on a list page per portal;
 * - refusals: a customer cannot sign in at /admin/login, and a signed-in customer gets "access denied" at /admin.
 *
 * Each portal signs in once and keeps its page (the gateway limits logins per IP; the login helper waits on 429).
 * Reduced motion: the KPI numbers show their final value at once and every section is visible to axe.
 */

const inrFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const countFormat = new Intl.NumberFormat('en-IN');
const percentFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
/** The app's own formats (lib/format, chart kit): ₹55,08,842 · 1,234 · 99.7% */
const inr = (value: number) => inrFormat.format(value);
const count = (value: number) => countFormat.format(value);
const percent = (value: number) => `${percentFormat.format(value)}%`;

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1366, height: 900 };

/** A signed-in page for one role, kept for every test of its describe block. */
async function signedIn(browser: Browser, email: string, portal: 'admin' | 'manager' | 'support' | 'customer'): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await logIn(page, email, demoPassword(), portal);
  return page;
}

/**
 * Opens `path` and returns the analytics request the page made itself (status 200): its query and the session's
 * bearer token (never printed).
 */
async function openAndCapture(page: Page, path: string, apiPath: RegExp): Promise<{ query: URLSearchParams; token: string }> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => apiPath.test(new URL(r.url()).pathname) && r.request().method() === 'GET' && r.status() === 200),
    page.goto(path),
  ]);
  const headers = await response.request().allHeaders();
  return { query: new URL(response.url()).searchParams, token: headers.authorization ?? '' };
}

/** The API read by the test itself with the session's token. */
async function apiGet<T>(page: Page, path: string, token: string): Promise<T> {
  const response = await page.request.get(`${API_URL}${path}`, { headers: { Authorization: token } });
  expect(response.status(), `GET ${path}`).toBe(200);
  return (await response.json()) as T;
}

/** The KPI card (a list item) with this label inside `region`. */
const kpi = (region: Locator, label: string) => region.getByRole('listitem').filter({ has: region.page().getByText(label, { exact: true }) });
/** A white figure of a headline band (label + value). */
const bandFigure = (region: Locator, label: string) => region.getByText(label, { exact: true }).locator('..');

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

/**
 * The page's next analytics request with these query parameters (a filter change). Live updates from other suites can
 * refetch the current figures at any time, so a request is matched by what it asks for, not by being the next one.
 */
const nextRequest = (page: Page, apiPath: RegExp, expected: Record<string, string | null>) => page.waitForRequest((r) => {
  const url = new URL(r.url());
  return apiPath.test(url.pathname) && r.method() === 'GET'
    && Object.entries(expected).every(([name, value]) => url.searchParams.get(name) === value);
});

interface AdminDashboardAnswer {
  range: { from: string; to: string };
  revenue: { gross: number; net: number };
  products: { hotel: { bookings: number }; flight: { bookings: number } };
  payments: { failedCount: number; successRate: number };
  customers: { newInRange: number };
  cancellations: { count: number };
}

test.describe('staff portals: admin', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;
  const DASHBOARD_API = /^\/api\/admin\/dashboard$/;

  test.beforeAll(async ({ browser }) => {
    page = await signedIn(browser, DEMO_ACCOUNTS.admin, 'admin');
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test('signs in at its own page and lands on the dashboard', async () => {
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
    await expect(page.getByText('Bookings per day').first()).toBeVisible();
  });

  test('key figures equal the API answer for the same session and range', async () => {
    // Other suites book and cancel on this stack at the same time: read the page and the API again until both agree.
    await expect(async () => {
      const { query, token } = await openAndCapture(page, '/admin?range=LAST_7_DAYS', DASHBOARD_API);
      expect(query.get('range')).toBe('LAST_7_DAYS');
      expect(query.has('interval')).toBe(false);
      const api = await apiGet<AdminDashboardAnswer>(page, '/admin/dashboard?range=LAST_7_DAYS', token);

      const revenue = page.getByRole('region', { name: 'Revenue', exact: true });
      await expect(bandFigure(revenue, 'Net revenue')).toContainText(inr(api.revenue.net), { timeout: 5_000 });
      await expect(bandFigure(revenue, 'Gross revenue')).toContainText(inr(api.revenue.gross), { timeout: 5_000 });
      const bookings = page.getByRole('region', { name: 'Bookings', exact: true });
      await expect(kpi(bookings, 'Hotel bookings')).toContainText(count(api.products.hotel.bookings), { timeout: 5_000 });
      await expect(kpi(bookings, 'Flight bookings')).toContainText(count(api.products.flight.bookings), { timeout: 5_000 });
      const payments = page.getByRole('region', { name: 'Payments' });
      await expect(kpi(payments, 'Failed payments')).toContainText(count(api.payments.failedCount), { timeout: 5_000 });
      await expect(kpi(payments, 'Payment success rate')).toContainText(percent(api.payments.successRate), { timeout: 5_000 });
      await expect(kpi(page.getByRole('region', { name: 'Cancellations' }), 'Cancellations')).toContainText(count(api.cancellations.count), { timeout: 5_000 });
      await expect(kpi(page.getByRole('region', { name: 'Customers' }), 'New customers')).toContainText(count(api.customers.newInRange), { timeout: 5_000 });
    }).toPass({ timeout: 150_000, intervals: [2_000, 5_000, 10_000] });
    // Never NaN or ∞ for a previous period of 0.
    await expect(page.getByRole('main')).not.toContainText(/NaN|Infinity|∞/);
  });

  test('changing the range or the interval changes the request and the URL', async () => {
    await page.goto('/admin');
    await expect(page.getByText('Bookings per day').first()).toBeVisible();

    let request = nextRequest(page, DASHBOARD_API, { range: 'THIS_YEAR', interval: null });
    await page.getByRole('combobox', { name: 'Date range' }).selectOption({ label: 'This year' });
    await request;
    await expect(page).toHaveURL(/\/admin\?range=THIS_YEAR$/);
    await expect(page.getByText(/^Bookings per month$/).first()).toBeVisible();

    request = nextRequest(page, DASHBOARD_API, { range: 'THIS_YEAR', interval: 'WEEK' });
    await page.getByText('Week', { exact: true }).click();
    await request;
    await expect(page).toHaveURL(/\/admin\?range=THIS_YEAR&interval=WEEK$/);
    await expect(page.getByText(/^Bookings per week$/).first()).toBeVisible();

    // Five years by day is more than the server draws: the option is disabled and the server chooses.
    // The chosen weekly interval still fits five years (≤ 262 points), so it is kept.
    request = nextRequest(page, DASHBOARD_API, { range: 'LAST_5_YEARS', interval: 'WEEK' });
    await page.getByRole('combobox', { name: 'Date range' }).selectOption({ label: 'Last 5 years' });
    await request;
    await expect(page.getByRole('radio', { name: 'Day' })).toBeDisabled();
  });

  test('axe: the dashboard and a list page', async () => {
    await page.goto('/admin?range=LAST_30_DAYS');
    await expect(page.getByText('Bookings per day').first()).toBeVisible();
    await expect(page.getByRole('table', { name: 'Popular destinations' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'admin dashboard v2');

    await page.goto('/admin/payments');
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'admin payments');

    await page.goto('/admin/hotels');
    await expect(page.getByRole('heading', { level: 1, name: 'Hotels' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'admin hotels');
  });

  test('phone width: no sideways scrolling, the drawer works', async () => {
    await page.setViewportSize(PHONE);
    try {
      await page.goto('/admin');
      await expect(page.getByText('Bookings per day').first()).toBeVisible();
      await expect(page.getByRole('table', { name: 'Popular destinations' })).toBeAttached();
      await expectNoSidewaysScroll(page);
      await expectNoSeriousA11yViolations(page, 'admin dashboard v2 (phone)');

      await page.getByRole('button', { name: 'Open navigation' }).click();
      const drawer = page.getByRole('dialog', { name: 'Admin portal navigation' });
      await expect(drawer.getByRole('navigation', { name: 'Admin' })).toBeVisible();
      await drawer.getByRole('link', { name: 'Payments' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
      await expect(drawer).toBeHidden();
      await expectNoSidewaysScroll(page);
    } finally {
      await page.setViewportSize(DESKTOP);
    }
  });
});

interface HotelDashboardAnswer {
  today: { arrivals: number; occupancyPercent: number; inHouseGuests: number };
  stats: { revenue: number; reservations: number; occupancyPercent: number; averageDailyRate: number; availableRoomNights: number };
}

test.describe('staff portals: hotel manager', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;
  let hotels: { id: string; name: string }[] = [];
  const DASHBOARD_API = /^\/api\/hotel-manager\/hotels\/[^/]+\/dashboard$/;

  test.beforeAll(async ({ browser }) => {
    page = await signedIn(browser, DEMO_ACCOUNTS.manager, 'manager');
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test('signs in at its own page and sees each hotel with live figures', async () => {
    await expect(page).toHaveURL(/\/hotel-manager$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My hotels' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hotel manager' })).toBeVisible();
    const tiles = page.getByRole('list', { name: 'Your hotels' }).getByRole('listitem');
    await expect(tiles.first()).toBeVisible();
    await expect(tiles.first()).toContainText('Occupancy tonight');
    await expect(tiles.first()).toContainText('Revenue, 30 days');
  });

  test('portfolio and dashboard figures equal the API answer for the same session and range', async () => {
    await expect(async () => {
      const [listAnswer] = await Promise.all([
        page.waitForResponse((r) => new URL(r.url()).pathname === '/api/hotel-manager/hotels' && r.status() === 200),
        page.goto('/hotel-manager'),
      ]);
      hotels = (await listAnswer.json()) as { id: string; name: string }[];
      expect(hotels.length).toBeGreaterThan(0);
      const first = hotels[0]!;
      const { query, token } = await openAndCapture(page, `/hotel-manager/hotels/${first.id}/dashboard`, DASHBOARD_API);
      expect(query.get('range')).toBe('LAST_30_DAYS');
      const api = await apiGet<HotelDashboardAnswer>(page, `/hotel-manager/hotels/${first.id}/dashboard?range=LAST_30_DAYS`, token);

      const today = page.getByRole('region', { name: 'Today at the front desk' });
      await expect(bandFigure(today, 'Arriving')).toContainText(count(api.today.arrivals), { timeout: 5_000 });
      await expect(bandFigure(today, 'In-house guests')).toContainText(count(api.today.inHouseGuests), { timeout: 5_000 });
      await expect(bandFigure(today, 'Occupancy tonight')).toContainText(percent(api.today.occupancyPercent), { timeout: 5_000 });
      const rooms = page.getByRole('region', { name: 'Rooms and revenue' });
      await expect(kpi(rooms, 'Revenue')).toContainText(inr(api.stats.revenue), { timeout: 5_000 });
      await expect(kpi(rooms, 'Occupancy')).toContainText(percent(api.stats.occupancyPercent), { timeout: 5_000 });
      await expect(kpi(rooms, 'Average daily rate (ADR)')).toContainText(inr(api.stats.averageDailyRate), { timeout: 5_000 });
      await expect(rooms.locator('dl > div').filter({ hasText: 'Available room nights' })).toContainText(count(api.stats.availableRoomNights), { timeout: 5_000 });
      await expect(kpi(page.getByRole('region', { name: 'Reservations and cancellations' }), 'Reservations'))
        .toContainText(count(api.stats.reservations), { timeout: 5_000 });

      // The portfolio card shows the same answer (same range, same cache entry).
      await page.goto('/hotel-manager');
      const tile = page.getByRole('list', { name: 'Your hotels' }).getByRole('listitem').filter({ has: page.getByRole('heading', { name: first.name }) });
      await expect(tile).toContainText(`Revenue, 30 days${inr(api.stats.revenue)}`, { timeout: 10_000 });
      await expect(tile).toContainText(`Arrivals today${count(api.today.arrivals)}`, { timeout: 10_000 });
    }).toPass({ timeout: 150_000, intervals: [2_000, 5_000, 10_000] });
  });

  test('changing the range or the interval changes the request and the URL', async () => {
    const first = hotels[0]!;
    await page.goto(`/hotel-manager/hotels/${first.id}/dashboard`);
    await expect(page.getByText('Revenue per day').first()).toBeVisible();

    let request = nextRequest(page, DASHBOARD_API, { range: 'LAST_90_DAYS', interval: null });
    await page.getByRole('combobox', { name: 'Date range' }).selectOption({ label: 'Last 90 days' });
    await request;
    await expect(page.getByText(/^Revenue per week$/).first()).toBeVisible();

    request = nextRequest(page, DASHBOARD_API, { range: 'LAST_90_DAYS', interval: 'DAY' });
    await page.getByText('Day', { exact: true }).click();
    await request;
    await expect(page).toHaveURL(/dashboard\?range=LAST_90_DAYS&interval=DAY$/);
    await expect(page.getByText(/^Revenue per day$/).first()).toBeVisible();
  });

  test('a hotel that is not assigned gets a clear message', async () => {
    // A real hotel of the catalogue that this manager does not manage.
    const stay = `checkIn=${isoDate(40)}&checkOut=${isoDate(41)}&rooms=1&adults=1&size=50`;
    const search = await page.request.get(`${API_URL}/hotels/search?destination=Goa&${stay}`);
    const found = ((await search.json()) as { content: { id: string }[] }).content.map((hotel) => hotel.id);
    const other = found.find((id) => !hotels.some((hotel) => hotel.id === id));
    test.skip(!other, 'every hotel in Goa is assigned to this manager');
    await page.goto(`/hotel-manager/hotels/${other}/dashboard`);
    await expect(page.getByRole('heading', { name: 'This hotel is not assigned to you' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'My hotels' })).toHaveAttribute('href', '/hotel-manager');
  });

  test('axe: portfolio, dashboard and a list page', async () => {
    const first = hotels[0]!;
    await page.goto('/hotel-manager');
    await expect(page.getByRole('list', { name: 'Your hotels' }).getByRole('listitem').first()).toContainText('Revenue, 30 days');
    await expectNoSeriousA11yViolations(page, 'hotel manager portfolio');

    await page.goto(`/hotel-manager/hotels/${first.id}/dashboard`);
    await expect(page.getByText('Revenue per day').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'hotel manager dashboard v2');

    await page.goto(`/hotel-manager/hotels/${first.id}/reviews`);
    await expect(page.getByRole('heading', { level: 2, name: 'Guest reviews' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'hotel manager reviews');
  });

  test('phone width: no sideways scrolling, the drawer works', async () => {
    const first = hotels[0]!;
    await page.setViewportSize(PHONE);
    try {
      await page.goto('/hotel-manager');
      await expect(page.getByRole('list', { name: 'Your hotels' }).getByRole('listitem').first()).toContainText('Revenue, 30 days');
      await expectNoSidewaysScroll(page);

      await page.goto(`/hotel-manager/hotels/${first.id}/dashboard`);
      await expect(page.getByText('Revenue per day').first()).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectNoSeriousA11yViolations(page, 'hotel manager dashboard v2 (phone)');

      await page.getByRole('button', { name: 'Open navigation' }).click();
      const drawer = page.getByRole('dialog', { name: 'Hotel manager portal navigation' });
      await expect(drawer.getByRole('navigation', { name: 'Hotel sections' })).toBeVisible();
      await drawer.getByRole('link', { name: 'Reservations' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Reservations' })).toBeVisible();
      await expect(drawer).toBeHidden();
      await expectNoSidewaysScroll(page);
    } finally {
      await page.setViewportSize(DESKTOP);
    }
  });
});

interface SupportMetricsAnswer {
  opened: number;
  resolved: number;
  open: number;
  byStatus: Record<string, number>;
}

test.describe('staff portals: support', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;
  const METRICS_API = /^\/api\/admin\/support\/metrics$/;

  test.beforeAll(async ({ browser }) => {
    page = await signedIn(browser, DEMO_ACCOUNTS.support, 'support');
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test('signs in at its own page and lands on the dashboard', async () => {
    await expect(page).toHaveURL(/\/support$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Support dashboard' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Support' })).toBeVisible();
  });

  test('key figures equal the API answer for the same session and range', async () => {
    await expect(async () => {
      const { query, token } = await openAndCapture(page, '/support?range=LAST_7_DAYS', METRICS_API);
      expect(query.get('range')).toBe('LAST_7_DAYS');
      const api = await apiGet<SupportMetricsAnswer>(page, '/admin/support/metrics?range=LAST_7_DAYS', token);
      const summary = await apiGet<{ open: number; escalated: number }>(page, '/admin/support/summary', token);

      const flow = page.getByRole('region', { name: 'Ticket flow' });
      await expect(kpi(flow, 'Tickets opened')).toContainText(count(api.opened), { timeout: 5_000 });
      await expect(kpi(flow, 'Tickets resolved')).toContainText(count(api.resolved), { timeout: 5_000 });
      await expect(kpi(flow, 'Open tickets now')).toContainText(count(api.open), { timeout: 5_000 });
      await expect(page.getByRole('link', { name: `Open: ${count(summary.open)}` })).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('link', { name: `Escalated: ${count(summary.escalated)}` })).toBeVisible({ timeout: 5_000 });
      // The status chart's table holds the same numbers.
      const statusTable = page.getByRole('table', { name: 'All tickets by status' });
      await expect(statusTable.getByRole('row', { name: /^Open\b/ }).first()).toContainText(count(api.byStatus.OPEN ?? 0), { timeout: 5_000 });
    }).toPass({ timeout: 150_000, intervals: [2_000, 5_000, 10_000] });
  });

  test('changing the range or the interval changes the request and the URL', async () => {
    await page.goto('/support');
    await expect(page.getByText('Tickets opened and resolved per day').first()).toBeVisible();

    let request = nextRequest(page, METRICS_API, { range: 'LAST_12_MONTHS', interval: null });
    await page.getByRole('combobox', { name: 'Date range' }).selectOption({ label: 'Last 12 months' });
    await request;
    await expect(page.getByText(/^Tickets opened and resolved per month$/).first()).toBeVisible();

    request = nextRequest(page, METRICS_API, { range: 'LAST_12_MONTHS', interval: 'WEEK' });
    await page.getByText('Week', { exact: true }).click();
    await request;
    await expect(page).toHaveURL(/\/support\?range=LAST_12_MONTHS&interval=WEEK$/);
  });

  test('axe: the dashboard and list pages', async () => {
    await page.goto('/support');
    await expect(page.getByText('Tickets opened and resolved per day').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /^Open: \d/ })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'support dashboard v2');

    await page.goto('/support/escalations');
    await expect(page.getByRole('heading', { level: 1, name: 'Escalations' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'support escalations');

    await page.goto('/support/bookings');
    await expect(page.getByRole('heading', { level: 1, name: 'Booking lookup' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'support booking lookup');
  });

  test('phone width: no sideways scrolling, the drawer works', async () => {
    await page.setViewportSize(PHONE);
    try {
      await page.goto('/support');
      await expect(page.getByText('Tickets opened and resolved per day').first()).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectNoSeriousA11yViolations(page, 'support dashboard v2 (phone)');

      await page.getByRole('button', { name: 'Open navigation' }).click();
      const drawer = page.getByRole('dialog', { name: 'Support portal navigation' });
      await expect(drawer.getByRole('navigation', { name: 'Support' })).toBeVisible();
      await drawer.getByRole('link', { name: 'Ticket queue' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Ticket queue' })).toBeVisible();
      await expect(drawer).toBeHidden();
      await expectNoSidewaysScroll(page);
    } finally {
      await page.setViewportSize(DESKTOP);
    }
  });
});

test.describe('staff portals: refusals', () => {
  test.use({ reducedMotion: 'reduce' });

  test('a customer at /admin/login sees "can\'t sign in here" and gets no session', async ({ page, context }) => {
    await page.goto(SIGN_IN.admin);
    await page.getByLabel('Email', { exact: true }).fill(DEMO_ACCOUNTS.customer);
    await page.getByLabel('Password', { exact: true }).fill(demoPassword());
    let status = 0;
    for (const delay of [0, 1_000, 2_000, 4_000]) {
      await page.waitForTimeout(delay);
      const answer = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      status = (await answer).status();
      if (status !== 429) break;
    }
    expect(status).toBe(403);
    await expect(page.getByRole('alert')).toContainText("This account can't sign in here");
    await expect(page).toHaveURL(/\/admin\/login$/);
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain('fh_refresh');

    // No session: the admin area still asks to sign in.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login\?redirect=%2Fadmin$/);
    await expect(page.getByRole('button', { name: /^Account menu/ })).toHaveCount(0);
  });

  test('a signed-in customer opening /admin sees access denied', async ({ page }) => {
    await logIn(page, DEMO_ACCOUNTS.customer, demoPassword(), 'customer');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1, name: "You don't have access to this page" })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in to the admin portal' })).toHaveAttribute('href', '/admin/login?redirect=%2Fadmin');
    await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);
  });
});
