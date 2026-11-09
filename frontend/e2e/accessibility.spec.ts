import { expect, test, type Page } from '@playwright/test';

import { newCustomer, logIn, type TestCustomer } from './support/auth';
import { bookConfirmedHotelStay, cancelBooking, registerVerifiedCustomer } from './support/api';
import { expectNoSeriousA11yViolations } from './support/axe';
import { DEMO_ACCOUNTS, demoPassword } from './support/env';
import { isoDate } from './support/wait';

/**
 * axe-core (WCAG 2.1 A + AA) on the key pages of every portal, at desktop width and, for public and customer pages
 * (the customer dashboard with data and without), phone width.
 * Serious and critical violations fail; everything axe reports is attached to the HTML report and printed.
 */

const checkIn = isoDate(45);
const checkOut = isoDate(47);
const hotelSearch = `/hotels/search?destination=Goa&checkIn=${checkIn}&checkOut=${checkOut}&rooms=1&adults=2`;
const flightSearch = `/flights/search?origin=DEL&destination=BOM&departureDate=${isoDate(40)}&adults=1`;

const h1 = (page: Page, name: string | RegExp) => page.getByRole('heading', { level: 1, name });

const SIGN_IN_PAGES = [
  { path: '/customer/login', heading: 'Log in' },
  { path: '/admin/login', heading: 'Log in to the admin portal' },
  { path: '/hotel-manager/login', heading: 'Log in to the partner portal' },
  { path: '/support/login', heading: 'Log in to the support portal' },
];

async function openHotelDetails(page: Page): Promise<void> {
  await page.goto(hotelSearch);
  await page.getByRole('link', { name: 'See rooms' }).first().click();
  await expect(page.getByRole('region', { name: 'Rooms and prices' }).getByRole('button', { name: /^Reserve / }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Guest reviews' })).toBeVisible();
}

test.describe('accessibility: public pages (desktop)', () => {
  test('home', async ({ page }) => {
    await page.goto('/');
    await expect(h1(page, /^Travel more with/)).toBeVisible();
    for (const section of ['Popular destinations', 'Recommended hotels', 'Popular flight routes', 'Special offers']) {
      await expect(page.getByRole('heading', { name: section })).toBeVisible();
    }
    await expectNoSeriousA11yViolations(page, 'home');
  });

  test('flight search results', async ({ page }) => {
    await page.goto(flightSearch);
    await expect(h1(page, /Delhi to Mumbai/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Flights' }).getByRole('listitem').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'flight search results');
  });

  test('hotel search results', async ({ page }) => {
    await page.goto(hotelSearch);
    await expect(h1(page, /hotels? in Goa$/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'See rooms' }).first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'hotel search results');
  });

  test('hotel details', async ({ page }) => {
    await openHotelDetails(page);
    await expectNoSeriousA11yViolations(page, 'hotel details');
  });

  for (const { path, heading } of SIGN_IN_PAGES) {
    test(`sign-in ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(h1(page, heading)).toBeVisible();
      await expectNoSeriousA11yViolations(page, `sign-in ${path}`);
    });
  }

  test('sign-in with the wrong portal (message and links)', async ({ page }) => {
    await page.goto('/hotel-manager/login');
    await page.getByLabel('Email', { exact: true }).fill(DEMO_ACCOUNTS.customer);
    await page.getByLabel('Password', { exact: true }).fill(demoPassword());
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText("This account can't sign in here");
    await expect(page).toHaveURL(/\/hotel-manager\/login$/);
    await expectNoSeriousA11yViolations(page, 'sign-in wrong portal');
  });

  test('old /login links keep their query', async ({ page }) => {
    await page.goto('/login?reason=verified');
    await expect(page).toHaveURL(/\/customer\/login\?reason=verified$/);
    await expect(page.getByText('Your email address is confirmed. You can log in now.')).toBeVisible();
  });

  test('register', async ({ page }) => {
    await page.goto('/register');
    await expect(h1(page, 'Create your account')).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'register');
  });

  test('register with validation errors', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter your first name')).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'register with errors');
  });

  test('offers', async ({ page }) => {
    await page.goto('/offers');
    await expect(h1(page, 'Offers')).toBeVisible();
    await expect(page.getByText('WELCOME10').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'offers');
  });

  test('about', async ({ page }) => {
    await page.goto('/about');
    await expect(h1(page, 'About us')).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'about');
  });

  test('help', async ({ page }) => {
    await page.goto('/help');
    await expect(h1(page, 'Help & Support')).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'help');
  });
});

test.describe('accessibility: public pages (phone 390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('home with the menu open', async ({ page }) => {
    await page.goto('/');
    await expect(h1(page, /^Travel more with/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Popular destinations' })).toBeVisible();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Main mobile' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'home (phone, menu open)');
  });

  test('hotel search results', async ({ page }) => {
    await page.goto(hotelSearch);
    await expect(h1(page, /hotels? in Goa$/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'See rooms' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(page.getByRole('complementary', { name: 'Filters' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'hotel search results (phone, filters open)');
  });

  test('flight search results', async ({ page }) => {
    await page.goto(flightSearch);
    await expect(h1(page, /Delhi to Mumbai/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Flights' }).getByRole('listitem').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'flight search results (phone)');
  });

  for (const { path, heading } of SIGN_IN_PAGES) {
    test(`sign-in ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(h1(page, heading)).toBeVisible();
      await expectNoSeriousA11yViolations(page, `sign-in ${path} (phone)`);
    });
  }

  test('offers', async ({ page }) => {
    await page.goto('/offers');
    await expect(h1(page, 'Offers')).toBeVisible();
    await expect(page.getByText('WELCOME10').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'offers (phone)');
  });
});

test.describe('accessibility: customer pages', () => {
  // A new customer with one confirmed stay, so My Trips, the booking and the notifications have content.
  let customer: TestCustomer;
  let token = '';
  let bookingId = '';

  test.beforeAll(async () => {
    customer = newCustomer('a11y', { firstName: 'Ira', lastName: 'Sen' });
    token = await registerVerifiedCustomer(customer);
    bookingId = (await bookConfirmedHotelStay(token, customer)).id;
  });

  // The room goes back on sale (the booking is only needed for the scans).
  test.afterAll(async () => {
    if (bookingId) {
      await cancelBooking(token, bookingId);
    }
  });

  test.beforeEach(async ({ page }) => {
    await logIn(page, customer.email, customer.password);
  });

  test('My Trips', async ({ page }) => {
    await page.goto('/my-trips');
    await expect(h1(page, 'My Trips')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Bookings' }).getByRole('listitem')).toHaveCount(1);
    await expectNoSeriousA11yViolations(page, 'my trips');
  });

  test('account menu and notification panel open', async ({ page }) => {
    await page.goto('/my-trips');
    await expect(h1(page, 'My Trips')).toBeVisible();
    await page.getByRole('button', { name: `Account menu for ${customer.firstName} ${customer.lastName}` }).click();
    await expect(page.getByRole('navigation', { name: 'Account', exact: true })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'account menu open');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Account', exact: true })).toBeHidden();

    await page.getByRole('banner').getByRole('button', { name: /^Notifications/ }).click();
    await expect(page.getByRole('list', { name: 'Latest notifications' }).getByRole('listitem').first()).toBeVisible({ timeout: 60_000 });
    await expectNoSeriousA11yViolations(page, 'notification panel open');
  });

  test('cancel booking (refund calculation)', async ({ page }) => {
    await page.goto(`/my-trips/${bookingId}/cancel`);
    await expect(h1(page, 'Cancel booking')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Refund calculation' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'cancel booking');
  });

  test('booking details', async ({ page }) => {
    await page.goto(`/my-trips/${bookingId}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Documents' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Documents of this booking' }).getByRole('listitem').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('list', { name: 'Booking timeline' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'booking details');
  });

  test('profile', async ({ page }) => {
    await page.goto('/account/profile');
    await expect(h1(page, 'My account')).toBeVisible();
    await expect(page.getByLabel('First name')).toHaveValue(customer.firstName);
    await expectNoSeriousA11yViolations(page, 'profile');
  });

  test('notification center', async ({ page }) => {
    await page.goto('/account/notifications');
    await expect(h1(page, 'My account')).toBeVisible();
    await expect(page.getByText('Booking confirmed').first()).toBeVisible({ timeout: 60_000 });
    await expectNoSeriousA11yViolations(page, 'notification center');
  });

  test('dashboard with a trip', async ({ page }) => {
    await page.goto('/customer/dashboard');
    await expectDashboardWithData(page, customer.firstName);
    await expectNoSeriousA11yViolations(page, 'customer dashboard');
  });

  test.describe('phone 390×844', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('dashboard with a trip', async ({ page }) => {
      await page.goto('/customer/dashboard');
      await expectDashboardWithData(page, customer.firstName);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page, 'customer dashboard (phone)');
    });
  });
});

test.describe('accessibility: dashboard of a customer who has not booked yet', () => {
  let customer: TestCustomer;

  test.beforeAll(async () => {
    customer = newCustomer('a11y-new', { firstName: 'Kabir', lastName: 'Shah' });
    await registerVerifiedCustomer(customer);
  });

  test.beforeEach(async ({ page }) => {
    await logIn(page, customer.email, customer.password);
    // Customers land on their dashboard after signing in.
    await expect(page).toHaveURL(/\/customer\/dashboard$/);
  });

  test('desktop', async ({ page }) => {
    await expectFirstTimeDashboard(page, customer.firstName);
    await expectNoSeriousA11yViolations(page, 'customer dashboard (no bookings)');
  });

  test.describe('phone 390×844', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('phone', async ({ page }) => {
      await expectFirstTimeDashboard(page, customer.firstName);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page, 'customer dashboard (no bookings, phone)');
    });
  });
});

/** The dashboard with the customer's confirmed stay: next trip, figures and charts loaded. */
async function expectDashboardWithData(page: Page, firstName: string): Promise<void> {
  await expect(h1(page, `Welcome, ${firstName}`)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your next trip' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Bookings figures' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Bookings per month' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Recent bookings' }).getByRole('listitem').first()).toBeVisible();
}

/** A customer without bookings gets the invitation, not a wall of zeros. */
async function expectFirstTimeDashboard(page: Page, firstName: string): Promise<void> {
  await expect(h1(page, `Welcome, ${firstName}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your first trip starts here' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Bookings figures' })).toHaveCount(0);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

test.describe('accessibility: admin portal', () => {
  test.beforeEach(async ({ page }) => {
    await logIn(page, DEMO_ACCOUNTS.admin, demoPassword(), 'admin');
  });

  test('dashboard', async ({ page }) => {
    await page.goto('/admin');
    await expect(h1(page, 'Dashboard')).toBeVisible();
    await expect(page.getByText('Bookings per day').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'admin dashboard');
  });

  test('reports', async ({ page }) => {
    await page.goto('/admin/reports');
    await expect(h1(page, 'Reports')).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'admin reports');
  });

  test('bookings report', async ({ page }) => {
    await page.goto('/admin/reports/bookings?range=LAST_30_DAYS');
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'admin bookings report');
  });

  test('bookings', async ({ page }) => {
    await page.goto('/admin/bookings');
    await expect(h1(page, 'Bookings')).toBeVisible();
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'admin bookings');
  });

  test('users', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(h1(page, 'Users')).toBeVisible();
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'admin users');
  });

  test.describe('phone 390×844', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('dashboard with the navigation drawer open', async ({ page }) => {
      await page.goto('/admin');
      await expect(h1(page, 'Dashboard')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.getByRole('button', { name: 'Open navigation' }).click();
      const drawer = page.getByRole('dialog', { name: 'Admin portal navigation' });
      await expect(drawer.getByRole('navigation', { name: 'Admin' })).toBeVisible();
      await expectNoSeriousA11yViolations(page, 'admin dashboard (phone, navigation open)');
      await drawer.getByRole('link', { name: 'Bookings' }).click();
      await expect(h1(page, 'Bookings')).toBeVisible();
      await expect(drawer).toBeHidden();
    });
  });
});

test.describe('accessibility: hotel manager portal', () => {
  test.beforeEach(async ({ page }) => {
    await logIn(page, DEMO_ACCOUNTS.manager, demoPassword(), 'manager');
    await expect(h1(page, 'My hotels')).toBeVisible();
  });

  test('dashboard', async ({ page }) => {
    await page.getByRole('main').getByRole('link').filter({ has: page.getByRole('heading', { level: 2 }) }).first().click();
    await expect(page).toHaveURL(/\/hotel-manager\/hotels\/[^/]+\/dashboard$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Dashboard' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'hotel manager dashboard');
  });

  test('reservations', async ({ page }) => {
    await page.getByRole('main').getByRole('link').filter({ has: page.getByRole('heading', { level: 2 }) }).first().click();
    await expect(page).toHaveURL(/\/hotel-manager\/hotels\/[^/]+\/dashboard$/);
    await page.getByRole('link', { name: 'Reservations' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Reservations' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'hotel manager reservations');
  });
});

test.describe('accessibility: support portal', () => {
  test.beforeEach(async ({ page }) => {
    await logIn(page, DEMO_ACCOUNTS.support, demoPassword(), 'support');
  });

  test('access denied (support agent opens the admin portal)', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(h1(page, "You don't have access to this page")).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute('href', '/support');
    await expect(page.getByRole('link', { name: 'Sign in to the admin portal' })).toHaveAttribute('href', '/admin/login?redirect=%2Fadmin%2Fusers');
    await expectNoSeriousA11yViolations(page, 'access denied');
  });

  test('dashboard', async ({ page }) => {
    await page.goto('/support');
    await expect(h1(page, 'Support dashboard')).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'support dashboard');
  });

  test('ticket queue', async ({ page }) => {
    await page.goto('/support/tickets');
    await expect(h1(page, 'Ticket queue')).toBeVisible();
    await expect(page.getByText(/TK-/).first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'support ticket queue');
  });
});
