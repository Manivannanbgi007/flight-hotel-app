import { expect, type Page } from '@playwright/test';

import { verificationPath } from './mailpit';
import { uniqueSuffix } from './wait';

export interface TestCustomer {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

/** A new customer with a unique address (example.com: Mailpit catches everything). */
export function newCustomer(tag: string, name: { firstName: string; lastName: string } = { firstName: 'Asha', lastName: 'Rao' }): TestCustomer {
  const suffix = uniqueSuffix();
  return { email: `e2e-${tag}-${suffix}@example.com`, password: `Trip${suffix}x9`, ...name };
}

/** The four sign-in pages (IMPLEMENTATION_PLAN.md §11.2): each role signs in at its own portal. */
export const SIGN_IN = {
  customer: '/customer/login',
  admin: '/admin/login',
  manager: '/hotel-manager/login',
  support: '/support/login',
} as const;

export type SignInPortal = keyof typeof SIGN_IN;

const isSignInPage = (url: URL) => /^\/((customer|admin|hotel-manager|support)\/)?login$/.test(url.pathname);

/**
 * The portal's sign-in form → wait until the app has left the sign-in page. Stays on the current page when it already
 * is that portal's sign-in page (e.g. after "Email confirmed" → "Log in").
 */
export async function logIn(page: Page, email: string, password: string, portal: SignInPortal = 'customer'): Promise<void> {
  if (new URL(page.url(), 'http://x').pathname !== SIGN_IN[portal]) {
    await page.goto(SIGN_IN[portal]);
  }
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await submitLogIn(page);
  await page.waitForURL((url) => !isSignInPage(url));
}

/** Delays before the next login attempt after `429` (the gateway allows a burst of 10 logins per IP, then 2 per second). */
const LOGIN_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];

/**
 * Presses "Log in" and, when the gateway's login rate limit answers `429` (several suites run on this machine at the
 * same time), waits (Retry-After or a growing delay) and presses it again. Other answers are left to the caller.
 */
async function submitLogIn(page: Page): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const answer = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/login'
      && response.request().method() === 'POST', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    const response = await answer;
    if (response.status() !== 429 || attempt >= LOGIN_BACKOFF_MS.length) {
      return;
    }
    const retryAfter = Number(response.headers()['retry-after']);
    await page.waitForTimeout(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : LOGIN_BACKOFF_MS[attempt]!);
  }
}

/**
 * §30 step 1 as a visitor does it: the registration form, the link from the verification e-mail (read in Mailpit),
 * "Email confirmed", then the login form.
 */
export async function registerVerifyAndLogIn(page: Page, customer: TestCustomer): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('First name').fill(customer.firstName);
  await page.getByLabel('Last name').fill(customer.lastName);
  await page.getByLabel('Email', { exact: true }).fill(customer.email);
  await page.getByLabel('Password', { exact: true }).fill(customer.password);
  await page.getByLabel('Repeat password').fill(customer.password);
  await page.getByRole('checkbox', { name: /I accept the terms of use/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  await page.goto(await verificationPath(customer.email));
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/customer\/login\?reason=verified/);
  await expect(page.getByText('Your email address is confirmed. You can log in now.')).toBeVisible();

  await logIn(page, customer.email, customer.password);
  await expect(page.getByRole('button', { name: `Account menu for ${customer.firstName} ${customer.lastName}` })).toBeVisible();
}
