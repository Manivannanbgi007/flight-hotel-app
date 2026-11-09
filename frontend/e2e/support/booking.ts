import { readFile } from 'node:fs/promises';
import { expect, type Download, type Locator, type Page, type Response } from '@playwright/test';

/** Timeouts for the back-end sagas (Kafka): holding, confirming with the supplier, cancelling and refunding. */
export const SAGA_TIMEOUT = 90_000;

/** The booking id from /my-trips/:bookingId/… */
export function bookingIdOf(page: Page): string {
  const id = /\/my-trips\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) {
    throw new Error(`No booking id in ${page.url()}`);
  }
  return id;
}

/**
 * Step 3 "Payment" with the DEMO provider: waits until the seats or room are held, starts the payment, then presses
 * "Pay" in the labelled demo checkout. The server verifies the signed result like a real payment.
 */
export async function payWithDemoProvider(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/my-trips\/[0-9a-f-]{36}\/pay$/);
  // "Securing your seats/room…" first; the payment step appears once the booking is PENDING_PAYMENT.
  await expect(page.getByRole('heading', { name: 'Payment', exact: true })).toBeVisible({ timeout: SAGA_TIMEOUT });
  await page.getByRole('button', { name: /^Pay ₹/ }).click();
  const demo = page.getByRole('region', { name: 'Demo payment' });
  await expect(demo).toBeVisible();
  await expect(demo.getByText('No real money is used')).toBeVisible();
  await demo.getByRole('button', { name: /^Pay ₹/ }).click();
  await expect(page).toHaveURL(/\/my-trips\/[0-9a-f-]{36}\/result$/);
}

/**
 * Step 4: the result page keeps checking the booking until the supplier has confirmed it. Returns the booking
 * reference shown to the customer.
 */
export async function expectConfirmedBySupplier(page: Page, supplierReference: { label: string; pattern: RegExp }): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Your booking is confirmed' })).toBeVisible({ timeout: SAGA_TIMEOUT });
  const reference = await definitionValue(page.getByRole('main'), 'Booking reference').innerText();
  expect(reference).toMatch(/^[A-Z]{2}-[A-Z0-9]{6,}$/);
  await expect(definitionValue(page.getByRole('main'), supplierReference.label)).toHaveText(supplierReference.pattern);
  return reference;
}

/** The `<dd>` that follows the `<dt>` with exactly this text. */
export function definitionValue(scope: Locator, term: string): Locator {
  return scope.locator('dt', { hasText: new RegExp(`^${escapeRegExp(term)}$`) }).locator('xpath=following-sibling::dd[1]');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Step 7: My Trips lists the booking with its reference and status; returns its card. */
export async function openTripCard(page: Page, reference: string): Promise<Locator> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My Trips' }).click();
  await expect(page.getByRole('heading', { name: 'My Trips', level: 1 })).toBeVisible();
  const card = page.getByRole('list', { name: 'Bookings' }).getByRole('listitem').filter({ hasText: `Reference ${reference}` });
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Confirmed', { exact: true })).toBeVisible();
  return card;
}

/**
 * Step 8: "Download confirmation" on the trip card. The PDF is made a few seconds after the confirmation (Kafka), so
 * until then the button says it is not ready yet and the customer tries again.
 */
export async function downloadConfirmation(page: Page, card: Locator, reference: string): Promise<{ download: Download; response: Response }> {
  const button = card.getByRole('button', { name: `Download confirmation ${reference}` });
  let result: { download: Download; response: Response } | undefined;
  await expect(async () => {
    const [response, download] = await Promise.all([
      page.waitForResponse((r) => /\/api\/documents\/[0-9a-f-]{36}\/download$/.test(new URL(r.url()).pathname), { timeout: 5_000 }),
      page.waitForEvent('download', { timeout: 5_000 }),
      button.click(),
    ]);
    result = { download, response };
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
  if (!result) {
    throw new Error('The confirmation was never downloaded');
  }
  return result;
}

/** A real PDF: served as application/pdf, the `%PDF-` signature, an end-of-file marker and a sensible size. */
export async function expectPdf({ download, response }: { download: Download; response: Response }, fileName: string): Promise<void> {
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  expect(download.suggestedFilename()).toBe(fileName);
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(bytes.subarray(-1024).toString('latin1')).toContain('%%EOF');
  expect(bytes.length).toBeGreaterThan(2_000);
  expect(bytes.length).toBeLessThan(5_000_000);
}

/**
 * Step 9: "Cancel booking" → the refund calculation from the server → reason, "I understand", confirm. Returns the
 * refund amount the page promised (e.g. "₹7,455.00").
 */
export async function submitCancellation(page: Page, bookingId: string): Promise<{ refund: string; fee: string }> {
  await page.getByRole('main').getByRole('link', { name: 'Cancel booking', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/my-trips/${bookingId}/cancel$`));
  await expect(page.getByRole('heading', { name: 'Cancel booking', level: 1 })).toBeVisible();
  const calculation = page.getByRole('region', { name: 'Refund calculation' });
  await expect(calculation).toBeVisible();
  const refund = (await definitionValue(calculation, 'Refund').innerText()).trim();
  const fee = (await calculation.locator('dt', { hasText: /^Cancellation fee/ }).locator('xpath=following-sibling::dd[1]').innerText()).trim();

  const confirm = page.getByRole('button', { name: 'Confirm cancellation' });
  await expect(confirm).toBeDisabled();
  await page.getByRole('radio', { name: 'Change of plans' }).check();
  await page.getByRole('checkbox', { name: `I understand that cancelling cannot be undone and that ${refund} will be refunded.` }).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page).toHaveURL(new RegExp(`/my-trips/${bookingId}$`));
  return { refund, fee };
}

/** The "Cancellation and refund" card on the booking page. */
export function cancellationCard(page: Page): Locator {
  return page.getByRole('region', { name: 'Cancellation and refund' });
}
