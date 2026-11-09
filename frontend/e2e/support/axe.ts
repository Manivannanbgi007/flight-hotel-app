import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** WCAG 2.1 level A and AA (axe-core tags). */
export const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Parts of pages that are not ours and cannot be fixed here:
 * - the OpenStreetMap embed on the hotel page is a third-party document in an iframe (its own markup and contrast);
 *   the iframe element itself has a title and stays checked.
 */
const THIRD_PARTY = ['iframe[src*="openstreetmap.org"]'];

/**
 * Waits until loading placeholders in the main content are gone (pulse and shimmer skeletons, "Loading…" statuses)
 * and every finite animation (fade-ins, slide-ins) has finished, so axe measures colours at full opacity.
 */
export async function settle(page: Page): Promise<void> {
  await expect(page.getByRole('main').locator('.animate-pulse, [data-skeleton]')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('main').getByRole('status').filter({ hasText: /^Loading…$/ })).toHaveCount(0);
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))));
}

/**
 * Runs axe (WCAG 2.1 A + AA) on the page as it is now. Every violation is attached to the report and printed;
 * serious and critical ones fail the test.
 */
export async function expectNoSeriousA11yViolations(page: Page, label: string): Promise<void> {
  await settle(page);
  let builder = new AxeBuilder({ page }).withTags(WCAG_21_AA);
  for (const selector of THIRD_PARTY) {
    builder = builder.exclude(selector);
  }
  const { violations } = await builder.analyze();

  const lines = violations.map((violation) =>
    `${violation.impact ?? 'unknown'} ${violation.id} x${violation.nodes.length}: ${violation.help}\n    ${violation.nodes
      .slice(0, 4).map((node) => `${node.target.join(' ')}  ${node.html.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n    ')}`);
  console.log(`[axe] ${label}: ${lines.length === 0 ? 'no violations' : `\n  ${lines.join('\n  ')}`}`);
  await test.info().attach(`axe ${label}`, { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });

  const blocking = violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`),
    `serious or critical accessibility violations on ${label}`).toEqual([]);
}
