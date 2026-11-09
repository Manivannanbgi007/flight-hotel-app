import { expect, test, type Locator } from '@playwright/test';

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
 * The complete flight journey of flight-hotel-app.txt §30 "End-to-End Tests", only through the UI: register and log in,
 * search, select, passenger details, DEMO payment, confirmation by the demo airline, My Trips, the confirmation PDF,
 * cancellation and the final refund.
 */
test('flight journey: register, book a refundable flight, pay, download the confirmation, cancel and get refunded', async ({ page }) => {
  const customer = newCustomer('flight', { firstName: 'Asha', lastName: 'Rao' });
  // The demo airline sells up to 330 days ahead; DEL → BOM flies every day.
  const departure = isoDate(randomDaysAhead(30, 150));
  let reference = '';
  let bookingId = '';

  await test.step('1. Register, confirm the e-mail address (Mailpit link) and log in', async () => {
    await registerVerifyAndLogIn(page, customer);
  });

  await test.step('2. Search for a one-way flight Delhi → Mumbai with refundable fares', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Flights' }).click();
    await expect(page.getByRole('heading', { name: 'Find a flight', level: 1 })).toBeVisible();
    const form = page.getByRole('search', { name: 'Search flights' });
    await expect(form.getByRole('radio', { name: 'One way' })).toBeChecked();
    await chooseAirport(form, 'From', 'DEL');
    await chooseAirport(form, 'To', 'BOM');
    await form.getByLabel('Departure').fill(departure);
    await form.getByRole('button', { name: 'Search flights' }).click();

    await expect(page).toHaveURL(/\/flights\/search\?.*origin=DEL.*destination=BOM/);
    await expect(page.getByRole('heading', { level: 1, name: /Delhi to Mumbai/ })).toBeVisible();
    // A refundable fare, so that cancelling pays money back.
    await page.getByRole('complementary', { name: 'Filters' }).getByRole('radio', { name: /^Refundable/ }).check();
    await expect(page).toHaveURL(/refundable=true/);
    const flights = page.getByRole('list', { name: 'Flights' });
    await expect(flights.getByRole('listitem').first()).toBeVisible();
    await expect(flights.getByText(/ · Non-refundable$/)).toHaveCount(0);
  });

  await test.step('3. Select a flight: re-priced trip with itinerary, baggage and fare rules', async () => {
    const option = page.getByRole('list', { name: 'Flights' }).getByRole('listitem').first();
    await expect(option.getByText(/ · Refundable$/)).toBeVisible();
    await option.getByRole('button', { name: /^Select / }).click();

    await expect(page).toHaveURL(/\/flights\/trip\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: /Delhi to Mumbai/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Itinerary' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fare rules' })).toBeVisible();
    // When the airline re-priced the fare, the new price must be accepted first.
    const acceptNewPrice = page.getByRole('checkbox', { name: /^I accept the new price/ });
    if (await acceptNewPrice.isVisible()) {
      await acceptNewPrice.check();
    }
    await page.getByRole('button', { name: 'Continue to passenger details' }).click();
  });

  await test.step('4. Enter passenger and contact details, review and confirm', async () => {
    await expect(page).toHaveURL(/\/book\/flight\/[^/]+$/);
    await expect(page.getByRole('heading', { name: 'Passenger details', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Adult 1' })).toBeVisible();
    await page.getByLabel('First name').fill(customer.firstName);
    await page.getByLabel('Last name').fill(customer.lastName);
    await page.getByLabel('Date of birth').fill('1990-04-12');
    await page.getByLabel('Gender').selectOption({ label: 'Female' });
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(customer.email);
    await page.getByLabel('Phone').fill('+91 98000 00000');
    await page.getByRole('button', { name: 'Review booking' }).click();

    await expect(page).toHaveURL(/\/book\/flight\/[^/]+\/review$/);
    await expect(page.getByRole('heading', { name: 'Review your booking', level: 1 })).toBeVisible();
    await expect(page.getByText(`Adult 1: ${customer.firstName} ${customer.lastName}`)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and continue to payment' }).click();
    // The terms must be accepted first.
    await expect(page.getByText('Please accept to continue')).toBeVisible();
    await page.getByRole('checkbox', { name: /^I accept the fare rules/ }).check();
    await page.getByRole('button', { name: 'Confirm and continue to payment' }).click();
  });

  await test.step('5. Pay with the DEMO payment provider', async () => {
    await payWithDemoProvider(page);
    bookingId = bookingIdOf(page);
  });

  await test.step('6. The demo airline confirms the booking (PNR)', async () => {
    reference = await expectConfirmedBySupplier(page, { label: 'Airline reference (PNR)', pattern: /^[A-Z0-9]{6}$/ });
    expect(reference).toMatch(/^FL-/);
    await expect(page.getByText('This is a demo booking with demo flight inventory.')).toBeVisible();
  });

  await test.step('7. The booking is in My Trips', async () => {
    const card = await openTripCard(page, reference);
    await expect(card.getByRole('link', { name: /Delhi to Mumbai/ })).toBeVisible();
    await expect(card.getByRole('link', { name: `Cancel booking ${reference}` })).toBeVisible();
  });

  await test.step('8. Download the booking confirmation (PDF)', async () => {
    const card = page.getByRole('list', { name: 'Bookings' }).getByRole('listitem').filter({ hasText: `Reference ${reference}` });
    await expectPdf(await downloadConfirmation(page, card, reference), `${reference}-confirmation.pdf`);
  });

  let refund = '';
  await test.step('9. Submit the cancellation (the airline keeps its fee)', async () => {
    const card = page.getByRole('list', { name: 'Bookings' }).getByRole('listitem').filter({ hasText: `Reference ${reference}` });
    await card.getByRole('link', { name: 'View details' }).click();
    await expect(page).toHaveURL(new RegExp(`/my-trips/${bookingId}$`));
    await expect(page.getByText(`Booking reference ${reference}`)).toBeVisible();
    const quote = await submitCancellation(page, bookingId);
    refund = quote.refund;
    expect(quote.fee).not.toBe('₹0.00');
    expect(amountOf(refund)).toBeGreaterThan(0);
  });

  await test.step('10. Final status: cancelled by the airline, partly refunded, refund completed', async () => {
    const card = cancellationCard(page);
    await expect(card).toBeVisible();
    await expect(definitionValue(card, 'Status')).toHaveText('Cancelled', { timeout: SAGA_TIMEOUT });
    await expect(definitionValue(card, 'Airline cancellation reference')).toHaveText(/^DX/);
    await expect(definitionValue(card, 'Refund')).toHaveText(refund);
    const refundItem = card.getByRole('list', { name: 'Refunds' }).getByRole('listitem');
    await expect(refundItem).toHaveCount(1, { timeout: SAGA_TIMEOUT });
    await expect(refundItem).toContainText(`${refund} · Cancellation`);
    await expect(refundItem.getByText('Refunded', { exact: true })).toBeVisible({ timeout: SAGA_TIMEOUT });
    await expect(card.getByText(`Refunded so far: ${refund}`)).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Partly refunded' })).toContainText('The cancellation fee was kept.');
    await expect(page.getByRole('main').getByRole('link', { name: 'Cancel booking' })).toHaveCount(0);

    // My Trips shows the same outcome.
    await page.getByRole('main').getByRole('link', { name: '← My Trips' }).click();
    const trip = page.getByRole('list', { name: 'Bookings' }).getByRole('listitem').filter({ hasText: `Reference ${reference}` });
    await expect(trip.getByText('Partly refunded', { exact: true })).toBeVisible();
    await expect(trip.getByRole('link', { name: `Cancel booking ${reference}` })).toHaveCount(0);
  });
});

/** Types into the airport field and picks the suggestion with that IATA code. */
async function chooseAirport(form: Locator, label: 'From' | 'To', code: string): Promise<void> {
  const field = form.getByRole('combobox', { name: label });
  await field.fill(code);
  await form.getByRole('listbox', { name: `${label} suggestions` }).getByRole('option', { name: new RegExp(`\\(${code}\\)`) }).first().click();
  await expect(field).toHaveValue(new RegExp(`\\(${code}\\)$`));
}

/** "₹12,345.60" → 12345.6 */
function amountOf(money: string): number {
  return Number(money.replace(/[^0-9.]/g, ''));
}
