import { expect, test } from '@playwright/test';

import { newCustomer, registerVerifyAndLogIn } from './support/auth';
import {
  bookingIdOf,
  cancellationCard,
  definitionValue,
  downloadConfirmation,
  expectConfirmedBySupplier,
  expectPdf,
  openTripCard,
  payWithDemoProvider,
  SAGA_TIMEOUT,
  submitCancellation,
} from './support/booking';
import { isoDate, randomDaysAhead } from './support/wait';

/**
 * The hotel version of flight-hotel-app.txt §30 "End-to-End Tests", only through the UI: register and log in, search
 * hotels, choose a room (flexible rate), guest details, DEMO payment, confirmation by the hotel, My Trips, the
 * confirmation PDF, a free cancellation and the full refund.
 */
test('hotel journey: register, book a flexible room, pay, download the confirmation, cancel for free and get refunded', async ({ page }) => {
  const customer = newCustomer('hotel', { firstName: 'Meera', lastName: 'Iyer' });
  // The seeded hotels sell 365 days ahead; far enough out that the free cancellation period (48 h) applies.
  const nightsAhead = randomDaysAhead(30, 300);
  const checkIn = isoDate(nightsAhead);
  const checkOut = isoDate(nightsAhead + 2);
  let reference = '';
  let bookingId = '';
  let total = '';

  await test.step('1. Register, confirm the e-mail address (Mailpit link) and log in', async () => {
    await registerVerifyAndLogIn(page, customer);
  });

  await test.step('2. Search hotels in Goa for two nights', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Hotels' }).click();
    await expect(page.getByRole('heading', { name: 'Find a hotel', level: 1 })).toBeVisible();
    const form = page.getByRole('search', { name: 'Search hotels' });
    await form.getByLabel('Destination').fill('Goa');
    await form.getByLabel('Check-in').fill(checkIn);
    await form.getByLabel('Check-out').fill(checkOut);
    await form.getByLabel('Rooms').selectOption('1');
    await form.getByLabel('Adults').selectOption('2');
    await form.getByRole('button', { name: 'Search hotels' }).click();

    await expect(page).toHaveURL(new RegExp(`/hotels/search\\?.*destination=Goa.*checkIn=${checkIn}.*checkOut=${checkOut}`));
    await expect(page.getByRole('heading', { level: 1, name: /^\d+ hotels? in Goa$/ })).toBeVisible();
    // Only offers that can be cancelled for free.
    await page.getByRole('complementary', { name: 'Filters' }).getByRole('checkbox', { name: 'Free cancellation' }).check();
    await expect(page).toHaveURL(/freeCancellation=true/);
  });

  await test.step('3. Choose a hotel and a room with the flexible rate', async () => {
    await page.getByRole('link', { name: 'See rooms' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/hotels/[^/?]+\\?.*checkIn=${checkIn}`));
    const rooms = page.getByRole('region', { name: 'Rooms and prices' });
    await expect(rooms.getByRole('button', { name: /^Reserve / }).first()).toBeVisible();
    // Read the name only once the hotel page is shown (the URL changes before a lazy page has rendered).
    const hotelName = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
    await rooms.getByRole('button', { name: /^Reserve .*, Flexible with breakfast$/, disabled: false }).first().click();

    await expect(page).toHaveURL(/\/hotels\/quote\/[^/]+$/);
    await expect(page.getByRole('heading', { name: 'Review your stay', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: hotelName })).toBeVisible();
    await expect(page.getByText(/Free cancellation/).first()).toBeVisible();
    total = (await definitionValue(page.getByRole('main'), 'Total').innerText()).trim();
    await page.getByRole('link', { name: 'Continue to guest details' }).click();
  });

  await test.step('4. Enter the guest and contact details, review and confirm', async () => {
    await expect(page).toHaveURL(/\/book\/hotel\/[^/]+$/);
    await expect(page.getByRole('heading', { name: 'Guest details', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lead guest' })).toBeVisible();
    await page.getByLabel('First name').fill(customer.firstName);
    await page.getByLabel('Last name').fill(customer.lastName);
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(customer.email);
    await page.getByLabel('Phone').fill('+91 98000 00000');
    await page.getByLabel('Special requests').fill('Late arrival, around 22:00');
    await page.getByRole('button', { name: 'Review booking' }).click();

    await expect(page).toHaveURL(/\/book\/hotel\/[^/]+\/review$/);
    await expect(page.getByRole('heading', { name: 'Review your booking', level: 1 })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(`${customer.firstName} ${customer.lastName}`);
    await page.getByRole('checkbox', { name: /^I accept the cancellation policy/ }).check();
    await page.getByRole('button', { name: 'Confirm and continue to payment' }).click();
  });

  await test.step('5. Pay with the DEMO payment provider', async () => {
    await payWithDemoProvider(page);
    bookingId = bookingIdOf(page);
  });

  await test.step('6. The hotel confirms the booking (confirmation number)', async () => {
    reference = await expectConfirmedBySupplier(page, { label: 'Hotel confirmation no.', pattern: /^H[2-9A-Z]{9}$/ });
    expect(reference).toMatch(/^HT-/);
    await expect(definitionValue(page.getByRole('main'), 'Total paid')).toHaveText(total);
  });

  await test.step('7. The booking is in My Trips', async () => {
    const card = await openTripCard(page, reference);
    await expect(card).toContainText('Goa');
    await expect(card.getByRole('link', { name: `Cancel booking ${reference}` })).toBeVisible();
  });

  await test.step('8. Download the booking confirmation (PDF)', async () => {
    const card = page.getByRole('list', { name: 'Bookings' }).getByRole('listitem').filter({ hasText: `Reference ${reference}` });
    await expectPdf(await downloadConfirmation(page, card, reference), `${reference}-confirmation.pdf`);
  });

  await test.step('9. Submit the cancellation (free cancellation: full refund)', async () => {
    const card = page.getByRole('list', { name: 'Bookings' }).getByRole('listitem').filter({ hasText: `Reference ${reference}` });
    await card.getByRole('link', { name: 'View details' }).click();
    await expect(page).toHaveURL(new RegExp(`/my-trips/${bookingId}$`));
    await expect(page.getByText(`Booking reference ${reference}`)).toBeVisible();
    const quote = await submitCancellation(page, bookingId);
    expect(quote.fee).toBe('₹0.00');
    expect(quote.refund).toBe(total);
  });

  await test.step('10. Final status: cancelled by the hotel, refunded in full, refund completed', async () => {
    const card = cancellationCard(page);
    await expect(card).toBeVisible();
    await expect(definitionValue(card, 'Status')).toHaveText('Cancelled', { timeout: SAGA_TIMEOUT });
    await expect(definitionValue(card, 'Hotel cancellation number')).toHaveText(/^HX[2-9A-Z]{8}$/);
    await expect(definitionValue(card, 'Refund')).toHaveText(total);
    const refundItem = card.getByRole('list', { name: 'Refunds' }).getByRole('listitem');
    await expect(refundItem).toHaveCount(1, { timeout: SAGA_TIMEOUT });
    await expect(refundItem).toContainText(`${total} · Cancellation`);
    await expect(refundItem.getByText('Refunded', { exact: true })).toBeVisible({ timeout: SAGA_TIMEOUT });
    await expect(card.getByText(`Refunded so far: ${total}`)).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Refunded' }).first()).toContainText('Your payment was refunded in full.');
    await expect(page.getByRole('main').getByRole('link', { name: 'Cancel booking' })).toHaveCount(0);

    // My Trips shows the same outcome.
    await page.getByRole('main').getByRole('link', { name: '← My Trips' }).click();
    const trip = page.getByRole('list', { name: 'Bookings' }).getByRole('listitem').filter({ hasText: `Reference ${reference}` });
    await expect(trip.getByText('Refunded', { exact: true })).toBeVisible();
    await expect(trip.getByRole('link', { name: `Cancel booking ${reference}` })).toHaveCount(0);
  });
});
