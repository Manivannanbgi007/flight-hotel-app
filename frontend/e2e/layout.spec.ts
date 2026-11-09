import { expect, test, type Locator, type Page } from '@playwright/test';

import { logIn } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';
import { DEMO_ACCOUNTS, demoPassword } from './support/env';

/**
 * The application layout in a real browser:
 * - staff sidebar (expand/collapse with the page following, tooltips, submenu, drawer) and header (search);
 * - the customer area's sidebar on the dashboard, My Trips and My account, and its drawer on phones;
 * - sidebar, header, page and the AI assistant's button never overlap;
 * - no sideways scrolling at tablet and phone widths.
 * Two logins (admin, customer): the login rate limit is shared by every suite on the machine.
 */

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function box(locator: Locator): Promise<Box> {
  const value = await locator.boundingBox();
  expect(value, 'element has a box').not.toBeNull();
  return value!;
}

async function expectNoSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

/** Waits for the sidebar's width animation to end. */
const settle = (page: Page) => page.waitForTimeout(550);

test.describe('layout', () => {
  test('staff portal: sidebar expands and collapses, the page follows, nothing overlaps', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('fh.staff.sidebarCollapsed'));
    await logIn(page, DEMO_ACCOUNTS.admin, demoPassword(), 'admin');
    await page.goto('/admin/bookings');
    await expect(page.getByRole('heading', { level: 1, name: 'Bookings' })).toBeVisible();

    const sidebar = page.locator('#staff-sidebar');
    const header = page.getByRole('banner');
    const main = page.getByRole('main');
    const launcher = page.getByRole('button', { name: 'Open the assistant' });
    await expect(launcher).toBeVisible({ timeout: 30_000 });

    const expanded = await box(sidebar);
    expect(Math.round(expanded.width)).toBe(272);
    expect(Math.round((await box(header)).x)).toBe(272);
    expect((await box(main)).x).toBeGreaterThanOrEqual(272);
    for (const other of [header, main, launcher]) expect(overlaps(await box(sidebar), await box(other))).toBe(false);
    expect(overlaps(await box(header), await box(launcher))).toBe(false);
    await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Bookings' })).toHaveAttribute('aria-current', 'page');

    // Everything clickable shows the hand cursor (buttons, sort headers, selects, checkboxes, links).
    const cursorOf = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).cursor);
    for (const control of [
      page.getByRole('button', { name: 'Collapse sidebar' }),
      page.getByRole('button', { name: 'Travel' }),
      page.getByRole('combobox', { name: 'Status' }),
      page.getByRole('checkbox', { name: 'Needs attention only' }),
      page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Next' }),
      page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Payments' }),
    ]) {
      expect(await cursorOf(control)).toBe('pointer');
    }
    expect(await cursorOf(page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Previous' }))).toBe('not-allowed');

    const mainWidth = (await box(main)).width;
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await settle(page);
    const collapsed = await box(sidebar);
    expect(Math.round(collapsed.width)).toBe(76);
    expect(Math.round((await box(header)).x)).toBe(76);
    // The page takes the room the sidebar gave up.
    expect(Math.round((await box(main)).width - mainWidth)).toBe(272 - 76);

    // Collapsed: icons with a tooltip on hover and keyboard focus; the name stays for screen readers.
    const payments = page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Payments' });
    await payments.hover();
    await expect(page.locator('[data-nav-tooltip]')).toHaveText('Payments');
    await expectNoSeriousA11yViolations(page, 'admin bookings, sidebar collapsed');
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await settle(page);
    expect(Math.round((await box(sidebar)).width)).toBe(272);
    await expect(page.locator('[data-nav-tooltip]')).toHaveCount(0);

    // A submenu (reports) and the header search.
    const nav = page.getByRole('navigation', { name: 'Admin' });
    await nav.getByRole('button', { name: 'Reports' }).click();
    await nav.getByRole('link', { name: 'Revenue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Revenue' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Revenue' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Revenue');
    await page.keyboard.press('/');
    await expect(page.getByRole('combobox', { name: 'Search hotels, flights, bookings and more' })).toBeFocused();
    await page.keyboard.type('HT-ZZZZZZZZ');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/search\?q=HT-ZZZZZZZZ$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Search results' })).toBeVisible();

    // Tablet: the sidebar is a drawer behind the menu button; no sideways scrolling.
    await page.setViewportSize({ width: 820, height: 1000 });
    await expect(sidebar).toBeHidden();
    await expectNoSidewaysScroll(page);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Admin portal navigation' });
    await expect(drawer.getByRole('navigation', { name: 'Admin' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('customer area: one sidebar on the dashboard, My Trips and My account; a drawer on phones', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('fh.customer.sidebarCollapsed'));
    await logIn(page, DEMO_ACCOUNTS.customer, demoPassword(), 'customer');
    const area = page.getByRole('complementary', { name: 'My account pages' });

    await page.goto('/customer/dashboard');
    await expect(area.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    await area.getByRole('link', { name: 'My trips' }).click();
    await expect(page).toHaveURL(/\/my-trips/);
    await expect(area.getByRole('link', { name: 'My trips' })).toHaveAttribute('aria-current', 'page');
    await area.getByRole('link', { name: 'Payment history' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible();
    await expect(area.getByRole('link', { name: 'Payment history' })).toHaveAttribute('aria-current', 'page');

    // Side by side with the page, never under the header or the assistant's button.
    const main = page.locator('#main');
    const launcher = page.getByRole('button', { name: 'Open the assistant' });
    await expect(launcher).toBeVisible({ timeout: 30_000 });
    expect(overlaps(await box(area), await box(launcher))).toBe(false);
    const content = await box(main.locator('h1').first());
    expect(content.x).toBeGreaterThan((await box(area)).x + (await box(area)).width);
    await expectNoSeriousA11yViolations(page, 'customer area: payment history');

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await settle(page);
    expect(Math.round((await box(area)).width)).toBe(76);
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await settle(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(area).toBeHidden();
    await expectNoSidewaysScroll(page);
    await page.getByRole('button', { name: 'My account menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'My account navigation' });
    await drawer.getByRole('link', { name: 'Profile' }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Personal details' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'customer area: profile (phone)');
  });
});
