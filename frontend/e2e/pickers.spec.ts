import { expect, test, type Page } from '@playwright/test';
import { addDays, format } from 'date-fns';

import { expectNoSeriousA11yViolations } from './support/axe';
import { isoDate } from './support/wait';

/**
 * The date picker, the restyled selects and the suggestion list in a real browser: the calendar opens in the top layer
 * (Popover API), a day is chosen with the mouse and the keyboard, the stay is shaded, and axe finds nothing serious
 * while the calendar is open. Public pages only (no login, so it does not use the shared login rate limit).
 */

/** A day button's name: "12 December 2026, Saturday" (then ", today" / ", selected" where they apply). */
const dayName = (date: Date) => new RegExp(`^${format(date, 'd MMMM yyyy, EEEE')}`);
const shown = (date: Date) => format(date, 'EEE, d MMM yyyy');
const daysAhead = (days: number) => addDays(new Date(new Date().setHours(0, 0, 0, 0)), days);

async function openHotelForm(page: Page) {
  await page.goto('/hotels');
  await expect(page.getByRole('heading', { name: 'Find a hotel', level: 1 })).toBeVisible();
  return page.getByRole('search', { name: 'Search hotels' });
}

test.describe('pickers', () => {
  test('hotel dates: two-month calendar above the page, mouse and keyboard, shaded stay, no serious axe findings', async ({ page }) => {
    const form = await openHotelForm(page);
    const checkIn = form.getByRole('combobox', { name: 'Check-in' });
    const checkOut = form.getByRole('combobox', { name: 'Check-out' });

    await checkIn.click();
    const calendar = page.getByRole('dialog', { name: 'Choose date' });
    await expect(calendar).toBeVisible();
    await expect(calendar.getByRole('grid')).toHaveCount(2);
    expect(await calendar.evaluate((panel) => panel.matches(':popover-open'))).toBe(true);
    await expect(checkIn).toHaveAttribute('aria-expanded', 'true');
    await expectNoSeriousA11yViolations(page, 'hotel search form with the check-in calendar open');

    // Mouse: a day three weeks ahead (paging to the next month when needed).
    const arrival = daysAhead(21);
    const arrivalButton = calendar.getByRole('button', { name: dayName(arrival) });
    if (!(await arrivalButton.isVisible())) await calendar.getByRole('button', { name: /next month/i }).click();
    await calendar.getByRole('button', { name: dayName(arrival) }).click();
    await expect(calendar).toBeHidden();
    await expect(checkIn).toHaveValue(shown(arrival));
    await expect(checkIn).toBeFocused();
    // The default check-out was before the new check-in: it moved to the next day.
    await expect(checkOut).toHaveValue(shown(addDays(arrival, 1)));

    // Keyboard: ↓ moves into the calendar on the chosen day, → twice, Enter.
    await checkOut.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('dialog', { name: 'Choose date' }).getByRole('button', { name: dayName(addDays(arrival, 1)) })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(checkOut).toHaveValue(shown(addDays(arrival, 3)));

    // The check-out calendar shades the three nights.
    await checkOut.click();
    const shaded = page.getByRole('dialog', { name: 'Choose date' }).locator('td.cal-range-middle:not([data-hidden])');
    await expect(shaded).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Choose date' })).toBeHidden();

    // A typed date (day first) works too.
    const typed = daysAhead(40);
    await checkIn.fill(format(typed, 'dd/MM/yyyy'));
    await page.keyboard.press('Tab');
    await expect(checkIn).toHaveValue(shown(typed));
  });

  test('selects keep native behaviour and get the customizable look; destination suggestions are a styled list', async ({ page }) => {
    const form = await openHotelForm(page);

    const adults = form.getByRole('combobox', { name: 'Adults' });
    expect(await adults.evaluate((select) => getComputedStyle(select).appearance)).toBe('base-select');
    await adults.click();
    expect(await adults.evaluate((select) => select.matches(':open'))).toBe(true);
    await page.keyboard.press('Escape');
    await adults.selectOption('3');
    await expect(adults).toHaveValue('3');

    const destination = form.getByRole('combobox', { name: 'Destination' });
    await destination.fill('G');
    const suggestions = page.getByRole('listbox', { name: 'Suggestions' });
    await expect(suggestions.getByRole('option', { name: /^Goa/ })).toBeVisible();
    await suggestions.getByRole('option', { name: /^Goa/ }).click();
    await expect(destination).toHaveValue('Goa');

    await form.getByRole('button', { name: 'Search hotels' }).click();
    await expect(page).toHaveURL(/\/hotels\/search\?.*destination=Goa.*adults=3/);
  });

  test('phone width: the calendar fits the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/hotels/search?destination=Goa&checkIn=${isoDate(30)}&checkOut=${isoDate(32)}&rooms=1&adults=2`);
    const checkIn = page.getByRole('search', { name: 'Search hotels' }).getByRole('combobox', { name: 'Check-in' });
    await checkIn.click();
    const calendar = page.getByRole('dialog', { name: 'Choose date' });
    await expect(calendar.getByRole('grid')).toHaveCount(1);
    const box = await calendar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});
