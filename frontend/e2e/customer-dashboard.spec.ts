import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { format, parseISO } from 'date-fns';

import { logIn, newCustomer, type TestCustomer } from './support/auth';
import { bookConfirmedHotelStay, cancelBooking, registerVerifiedCustomer } from './support/api';

/**
 * The customer dashboard shows the API's figures, nothing hard-coded (IMPLEMENTATION_PLAN.md §11.3): a new customer
 * with one confirmed, paid stay signs in, and every figure on the page is compared with the answer of
 * `GET /api/bookings/summary` read with the same session (the access token the page itself sent), and with the
 * booking that was made.
 */

interface Summary {
  range: { preset: string; from: string; to: string };
  bookings: { total: number; hotel: number; flight: number; upcoming: number; completed: number; cancelled: number };
  trips: { upcoming: number; completed: number; cancelled: number; pending: number };
  spending: { paid: number; refunded: number; net: number; refundsInProgress: number };
  nextTrip: { reference: string; bookingId: string; hotel: { hotelName: string } | null } | null;
}

/** The page's own formats: whole numbers and rupees with Indian grouping (lib/format.ts). */
const count = (value: number) => new Intl.NumberFormat('en-IN').format(value);
const rupees = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

/** The page's period line: "1 Dec 2025 – 6 Nov 2026", "1 Jan – 6 Nov 2026" or one day "6 Nov 2026". */
function periodText({ from, to }: { from: string; to: string }): string {
  const start = parseISO(from);
  const end = parseISO(to);
  if (from === to) return format(end, 'd MMM yyyy');
  return `${format(start, start.getFullYear() === end.getFullYear() ? 'd MMM' : 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`;
}

// KPI numbers count up; with reduced motion they show the final value at once.
test.use({ reducedMotion: 'reduce' });

let customer: TestCustomer;
let token = '';
let booking: { id: string; reference: string };

test.beforeAll(async () => {
  customer = newCustomer('dashboard', { firstName: 'Nisha', lastName: 'Menon' });
  token = await registerVerifiedCustomer(customer);
  booking = await bookConfirmedHotelStay(token, customer);
});

test.afterAll(async () => {
  if (booking?.id) {
    await cancelBooking(token, booking.id);
  }
});

test('the dashboard shows the summary API\'s figures for the signed-in customer', async ({ page }) => {
  let summaryRequest: Promise<Request> | undefined;

  await test.step('Sign in: customers land on their dashboard', async () => {
    summaryRequest = waitForSummaryRequest(page, 'LAST_12_MONTHS');
    await logIn(page, customer.email, customer.password);
    await expect(page).toHaveURL(/\/customer\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1, name: `Welcome, ${customer.firstName}` })).toBeVisible();
  });

  const request = await summaryRequest!;
  const authorization = request.headers().authorization ?? '';
  expect(authorization).toMatch(/^Bearer /);

  await test.step('Last 12 months: every figure equals the API answer for the same session', async () => {
    const summary = await readSummary(page, authorization, 'range=LAST_12_MONTHS');
    // The data behind it is real: the one stay this test booked and paid.
    const details = await readJson<{ totalAmount: number }>(page, authorization, `/api/bookings/${booking.id}`);
    expect(summary.bookings).toMatchObject({ total: 1, hotel: 1, flight: 0, upcoming: 1 });
    expect(summary.spending.paid).toBe(details.totalAmount);
    expect(summary.nextTrip?.reference).toBe(booking.reference);

    await expectFigures(page, summary);
    const nextTrip = page.getByRole('region', { name: 'Your next trip' });
    await expect(nextTrip).toContainText(summary.nextTrip!.hotel!.hotelName);
    await expect(nextTrip.getByRole('link', { name: `View booking ${booking.reference}` })).toHaveAttribute('href', `/my-trips/${booking.id}`);
    // Nothing in the previous period: "New", never a made-up percentage.
    await expect(kpi(page, 'Bookings figures', 'Bookings').getByText(/^New/)).toBeVisible();
    // The latest bookings come from My Trips.
    await expect(page.getByRole('list', { name: 'Recent bookings' }).getByRole('listitem').filter({ hasText: `Reference ${booking.reference}` })).toHaveCount(1);
  });

  await test.step('All time: the period is in the URL and the figures follow the API', async () => {
    const allTime = waitForSummaryRequest(page, 'ALL_TIME');
    // click, not check(): the URL (and with it the checked radio) updates right after the click, asynchronously.
    await page.getByRole('radio', { name: 'All time' }).click();
    await expect(page.getByRole('radio', { name: 'All time' })).toBeChecked();
    await expect(page).toHaveURL(/\/customer\/dashboard\?range=ALL_TIME$/);
    await allTime;
    const summary = await readSummary(page, authorization, 'range=ALL_TIME');
    await expect(page.getByText(/no earlier period to compare with/)).toBeVisible();
    await expectFigures(page, summary);

    // A reload keeps the period.
    await page.reload();
    await expect(page.getByRole('radio', { name: 'All time' })).toBeChecked();
    await expectFigures(page, summary);
  });
});

/** Waits for the page's own summary request for a preset (not the previous-period call). */
function waitForSummaryRequest(page: Page, preset: string): Promise<Request> {
  return page.waitForRequest((request) => {
    const url = new URL(request.url());
    const range = url.searchParams.get('range');
    return url.pathname === '/api/bookings/summary' && (range === preset || (preset === 'LAST_12_MONTHS' && range === null));
  });
}

async function readJson<T>(page: Page, authorization: string, path: string): Promise<T> {
  const response = await page.request.get(path, { headers: { Authorization: authorization } });
  expect(response.status(), `GET ${path}`).toBe(200);
  return (await response.json()) as T;
}

function readSummary(page: Page, authorization: string, query: string): Promise<Summary> {
  return readJson<Summary>(page, authorization, `/api/bookings/summary?${query}`);
}

/** The KPI card with exactly this label in the named list. */
function kpi(page: Page, list: string, label: string): Locator {
  return page.getByRole('list', { name: list }).getByRole('listitem').filter({ has: page.getByText(label, { exact: true }) });
}

async function expectFigure(page: Page, list: string, label: string, value: string): Promise<void> {
  await expect(kpi(page, list, label).getByText(value, { exact: true }).first()).toBeVisible();
}

async function expectFigures(page: Page, summary: Summary): Promise<void> {
  // The period the server resolved ("1 Dec 2025 – 6 Nov 2026").
  await expect(page.getByRole('region', { name: 'Your travel at a glance' }).getByText(periodText(summary.range), { exact: true })).toBeVisible();
  await expectFigure(page, 'Bookings figures', 'Bookings', count(summary.bookings.total));
  await expectFigure(page, 'Bookings figures', 'Hotel stays', count(summary.bookings.hotel));
  await expectFigure(page, 'Bookings figures', 'Flights', count(summary.bookings.flight));
  await expect(kpi(page, 'Bookings figures', 'Bookings'))
    .toContainText(`${summary.bookings.upcoming} upcoming · ${summary.bookings.completed} completed · ${summary.bookings.cancelled} cancelled`);
  await expectFigure(page, 'Trip figures', 'Upcoming trips', count(summary.trips.upcoming));
  await expectFigure(page, 'Trip figures', 'Completed trips', count(summary.trips.completed));
  await expectFigure(page, 'Trip figures', 'Cancelled trips', count(summary.trips.cancelled));
  await expectFigure(page, 'Spending figures', 'Paid', rupees(summary.spending.paid));
  await expectFigure(page, 'Spending figures', 'Refunded', rupees(summary.spending.refunded));
  await expectFigure(page, 'Spending figures', 'Net spending', rupees(summary.spending.net));
}
