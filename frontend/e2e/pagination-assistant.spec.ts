import { expect, test, type Locator, type Page } from '@playwright/test';

import { logIn } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';
import { DEMO_ACCOUNTS, demoPassword } from './support/env';

/**
 * Table pagination and the AI assistant together, in a real browser (admin bookings: many rows):
 * - the pagination never sits under the assistant's floating button, also when it is scrolled to the bottom edge;
 * - "Rows per page" changes the page size from page 1, kept in the URL;
 * - the assistant's three states: minimized, normal (500 px wide) and maximized (the whole window), remembered.
 * One admin login (the login rate limit is shared by every suite on the machine).
 */

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value, 'element has a box').not.toBeNull();
  return value!;
}

/** Scrolls so that the element's bottom edge is `gap` px above the bottom of the window. */
async function scrollToBottomEdge(page: Page, locator: Locator, gap: number) {
  await locator.evaluate((element, offset) => {
    const rect = element.getBoundingClientRect();
    window.scrollBy(0, rect.bottom - (window.innerHeight - offset));
  }, gap);
  // The launcher re-measures on the next animation frame.
  await page.waitForTimeout(400);
}

test.describe('pagination and the AI assistant', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('fh.assistant.maximized'));
    await logIn(page, DEMO_ACCOUNTS.admin, demoPassword(), 'admin');
  });

  test('admin bookings: modern pagination, page sizes, and the assistant button never covers it', async ({ page }) => {
    await page.goto('/admin/bookings');
    const pages = page.getByRole('navigation', { name: 'Pages' });
    await expect(pages).toBeVisible();
    await expect(pages.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await expect(pages.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(/^Page 1 of \d+$/)).toBeVisible();
    const launcher = page.getByRole('button', { name: 'Open the assistant' });
    await expect(launcher).toBeVisible();

    // Pagination at the very bottom of the window, then a little higher, then scrolled to the end of the page.
    const bar = page.locator('[data-assistant-avoid]').first();
    for (const gap of [4, 40]) {
      await scrollToBottomEdge(page, bar, gap);
      expect(overlaps(await box(launcher), await box(bar)), `launcher clear of the pagination (gap ${gap}px)`).toBe(false);
      await pages.getByRole('button', { name: 'Next' }).click({ trial: true });
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    expect(overlaps(await box(launcher), await box(bar))).toBe(false);

    await pages.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/[?&]page=1/);
    await expect(pages.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('50');
    await expect(page).toHaveURL(/[?&]size=50/);
    await expect(page).not.toHaveURL(/[?&]page=/);
    await expect(page.locator('[data-assistant-avoid] p').first()).toContainText('Showing 1–50 of');
    await expect(page.locator('tbody tr')).toHaveCount(50);
    await expectNoSeriousA11yViolations(page, 'admin bookings with the new pagination');
  });

  test('the assistant: normal is 500 px wide, maximized fills the window and is remembered, minimize returns to the button', async ({ page }) => {
    await page.goto('/admin/payments');
    const launcher = page.getByRole('button', { name: 'Open the assistant' });
    await launcher.click();
    const panel = page.getByRole('dialog', { name: 'AI assistant' });
    await expect(panel).toBeVisible();
    await page.waitForTimeout(300);
    expect(Math.round((await box(panel)).width)).toBe(500);
    await expect(panel).not.toHaveAttribute('aria-modal', 'true');

    await panel.getByRole('button', { name: 'Maximize the assistant' }).click();
    await page.waitForTimeout(300);
    const viewport = page.viewportSize()!;
    const maximized = await box(panel);
    expect(maximized.height).toBeGreaterThan(viewport.height - 60);
    expect(maximized.width).toBeGreaterThan(viewport.width - 60);
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    // The floating button hides behind a maximized panel (the panel has Minimize).
    await expect(launcher).toBeHidden();
    // The question box and the header stay in view.
    await expect(panel.getByRole('textbox', { name: 'Your question' })).toBeInViewport();
    await expect(panel.getByRole('button', { name: 'Minimize the assistant' })).toBeInViewport();
    await expectNoSeriousA11yViolations(page, 'assistant maximized');

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(launcher).toBeFocused();

    // Opened again: still maximized; Restore brings back the docked panel.
    await launcher.click();
    await expect(panel.getByRole('button', { name: 'Restore the assistant to its normal size' })).toBeVisible();
    await panel.getByRole('button', { name: 'Restore the assistant to its normal size' }).click();
    await page.waitForTimeout(300);
    expect(Math.round((await box(panel)).width)).toBe(500);
    await panel.getByRole('button', { name: 'Minimize the assistant' }).click();
    await expect(panel).toBeHidden();
    await expect(launcher).toBeVisible();
  });
});
