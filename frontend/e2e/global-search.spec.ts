import { expect, test, type Browser, type Page } from '@playwright/test';

import { logIn } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';
import { API_URL, BASE_URL, DEMO_ACCOUNTS, demoPassword } from './support/env';

/**
 * Global search (docs/GLOBAL_SEARCH_IMPLEMENTATION.md) in the real stack, through the header box of each area:
 * - signed out: a typo still finds Chennai, the match is highlighted, the keyboard opens a result, Enter alone opens the
 *   results page, and another city name ("Banglore" for Bengaluru) works;
 * - admin: a real booking reference opens the admin booking page;
 * - customer: "Paymnt" opens My payments, and another customer's booking reference finds nothing;
 * - hotel manager: "room inventory" opens the inventory of one of their hotels;
 * - support: the results page understands "open tickets" (chip, tabs);
 * - axe on the results pages.
 * The index is filled from Kafka events, so the data is whatever the stack holds; nothing is hard-coded but city names.
 */

const DESKTOP = { width: 1366, height: 900 };
const BOX = 'Search hotels, flights, bookings and more';
/** A booking reference (HT-/FL- and 8 characters); no \b: an option's text joins title and subtitle without a space. */
const REFERENCE = /(?:HT|FL)-[A-Z0-9]{8}/;

test.describe.configure({ mode: 'serial' });

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: DESKTOP, reducedMotion: 'reduce' });
  return context.newPage();
}

async function signedIn(browser: Browser, email: string, portal: 'admin' | 'manager' | 'support' | 'customer'): Promise<Page> {
  const page = await newPage(browser);
  await logIn(page, email, demoPassword(), portal);
  return page;
}

function searchBox(page: Page) {
  return page.getByRole('combobox', { name: BOX });
}

function suggestions(page: Page) {
  return page.getByRole('listbox', { name: 'Search suggestions' });
}

/**
 * A suggestion containing `text`. "View all results for “…”" also contains the typed words (and shows while the
 * results load), so it is left out.
 */
function suggestion(page: Page, text: string | RegExp) {
  return suggestions(page).getByRole('option').filter({ hasText: text }).filter({ hasNotText: 'View all results' });
}

/** A booking reference the given customer does not own, found with an admin token through the search API. */
async function someoneElsesReference(customerEmail: string): Promise<string> {
  const login = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_ACCOUNTS.admin, password: demoPassword(), portal: 'ADMIN' }),
  });
  expect(login.ok).toBeTruthy();
  const { accessToken } = (await login.json()) as { accessToken: string };
  const answer = await fetch(`${API_URL}/search?q=bookings&category=BOOKINGS&size=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(answer.ok).toBeTruthy();
  const body = (await answer.json()) as { results: { content: { meta: { label: string; value: string }[] }[] } };
  const other = body.results.content.find((result) =>
    result.meta.some((meta) => meta.label === 'Contact' && meta.value !== customerEmail));
  const reference = other?.meta.find((meta) => meta.label === 'Reference')?.value;
  expect(reference, 'a booking of another customer').toMatch(REFERENCE);
  return reference!;
}

test('signed out: typo-tolerant suggestions, keyboard and the results page', async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto('/');

  await searchBox(page).fill('Chenai');
  const chennai = suggestion(page, 'Chennai').first();
  await expect(chennai).toBeVisible();
  await expect(suggestions(page).locator('mark').first()).toBeVisible();

  await page.mouse.move(0, 0);
  await searchBox(page).press('ArrowDown');
  await searchBox(page).press('Enter');
  await expect(page).toHaveURL(/\/hotels\//);

  await searchBox(page).fill('Banglore');
  await expect(suggestion(page, 'Bengaluru').first()).toBeVisible();
  await searchBox(page).press('Enter');
  await expect(page).toHaveURL(/\/search\?q=Banglore/);
  await expect(page.getByRole('heading', { level: 1, name: 'Search results' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Bengaluru').first()).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'search results, signed out');
});

test('admin: a booking reference opens the admin booking page', async ({ browser }) => {
  const page = await signedIn(browser, DEMO_ACCOUNTS.admin, 'admin');

  // "/" jumps into the box once the portal (loaded lazily) shows it.
  await expect(searchBox(page)).toBeVisible();
  await page.keyboard.press('/');
  await expect(searchBox(page)).toBeFocused();
  await searchBox(page).fill('bookings');
  const booking = suggestion(page, REFERENCE).first();
  await expect(booking).toBeVisible();
  const reference = REFERENCE.exec((await booking.textContent()) ?? '')?.[0];
  expect(reference).toBeTruthy();

  await searchBox(page).fill(reference!);
  const exact = suggestion(page, reference!).first();
  await expect(exact).toBeVisible();
  await exact.click();
  await expect(page).toHaveURL(/\/admin\/(bookings|payments)\/[0-9a-f-]{36}$/);
  await expect(page.getByText(reference!).first()).toBeVisible();
});

test('customer: pages by typo, and nothing of another customer', async ({ browser }) => {
  const page = await signedIn(browser, DEMO_ACCOUNTS.customer, 'customer');

  await searchBox(page).fill('Paymnt');
  const payments = suggestion(page, 'My payments').first();
  await expect(payments).toBeVisible();
  await payments.click();
  await expect(page).toHaveURL(/\/account\/payments/);

  const reference = await someoneElsesReference(DEMO_ACCOUNTS.customer);
  await searchBox(page).fill(reference);
  // The visible message (a copy is also announced to screen readers).
  await expect(page.getByText(`No results for “${reference}”`).first()).toBeVisible();
  await expect(suggestion(page, reference)).toHaveCount(0);
});

test('hotel manager: room inventory of one of their hotels', async ({ browser }) => {
  const page = await signedIn(browser, DEMO_ACCOUNTS.manager, 'manager');

  await searchBox(page).fill('room inventory');
  const inventory = suggestion(page, 'Room inventory').first();
  await expect(inventory).toBeVisible();
  // The pointer is still where "Log in" was; hovering an option makes it the active one, so move it away first.
  await page.mouse.move(0, 0);
  await searchBox(page).press('ArrowDown');
  await expect(searchBox(page)).toHaveAttribute('aria-activedescendant', /.+/);
  await expect(inventory).toHaveAttribute('aria-selected', 'true');
  await searchBox(page).press('Enter');
  await expect(page).toHaveURL(/\/hotel-manager\/hotels\/[0-9a-f-]{36}\/inventory$/);
});

test('support: the results page understands the words', async ({ browser }) => {
  const page = await signedIn(browser, DEMO_ACCOUNTS.support, 'support');

  await searchBox(page).fill('open tickets');
  await expect(suggestions(page)).toBeVisible();
  await searchBox(page).press('Enter');
  await expect(page).toHaveURL(/\/support\/search\?q=open\+tickets/);
  await expect(page.getByText('Open support tickets').first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Result categories' })).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'search results, support');
});
