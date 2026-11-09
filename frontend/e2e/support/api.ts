import { randomUUID } from 'node:crypto';

import type { TestCustomer } from './auth';
import { API_URL } from './env';
import { verificationPath } from './mailpit';
import { eventually, isoDate, randomDaysAhead } from './wait';

/**
 * Set-up through the API for tests that need data but are not about the booking flow (the accessibility scans):
 * a verified customer with a confirmed, paid hotel stay. The journeys themselves never use this.
 */
async function call<T>(method: string, path: string, options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

async function ok<T>(method: string, path: string, options: Parameters<typeof call>[2] = {}): Promise<T> {
  const { status, body } = await call<T>(method, path, options);
  if (status >= 300) {
    throw new Error(`${method} ${path} answered ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

/** Registers the customer, opens the link from the verification e-mail and returns an access token. */
export async function registerVerifiedCustomer(customer: TestCustomer): Promise<string> {
  await ok('POST', '/auth/register', { body: { ...customer, acceptTerms: true } });
  const token = new URLSearchParams((await verificationPath(customer.email)).split('?')[1]).get('token');
  await ok('POST', '/auth/verify-email', { body: { token } });
  return (await ok<{ accessToken: string }>('POST', '/auth/login', { body: { email: customer.email, password: customer.password } })).accessToken;
}

interface Booking {
  id: string;
  reference: string;
  status: string;
}

/** A confirmed and paid two-night stay in Goa (flexible rate, DEMO payment). */
export async function bookConfirmedHotelStay(token: string, customer: TestCustomer): Promise<Booking> {
  const days = randomDaysAhead(30, 300);
  const stay = { checkIn: isoDate(days), checkOut: isoDate(days + 2), rooms: 1, adults: 1, children: 0, childAges: [] };
  const search = await ok<{ content: { id: string }[] }>('GET',
    `/hotels/search?destination=Goa&checkIn=${stay.checkIn}&checkOut=${stay.checkOut}&rooms=1&adults=1&freeCancellation=true&size=1`);
  const hotelId = search.content[0]?.id;
  const rooms = await ok<{ roomTypes: { available: boolean; roomType: { id: string }; rates: { ratePlanId: string; name: string }[] }[] }>('GET',
    `/hotels/${hotelId}/rooms?checkIn=${stay.checkIn}&checkOut=${stay.checkOut}&rooms=1&adults=1`);
  const room = rooms.roomTypes.find((r) => r.available && r.rates.some((rate) => rate.name.startsWith('Flexible')));
  const rate = room?.rates.find((r) => r.name.startsWith('Flexible'));
  if (!hotelId || !room || !rate) {
    throw new Error(`No flexible room in Goa for ${stay.checkIn}`);
  }
  const quote = await ok<{ quoteId: string }>('POST', '/hotels/availability',
    { body: { hotelId, roomTypeId: room.roomType.id, ratePlanId: rate.ratePlanId, stay } });
  const created = await ok<Booking>('POST', '/bookings/hotel', {
    token,
    headers: { 'Idempotency-Key': `e2e-${randomUUID()}` },
    body: { quoteId: quote.quoteId, contact: { email: customer.email, phone: '+91 98000 00000' },
      guests: [{ roomNo: 1, firstName: customer.firstName, lastName: customer.lastName }] },
  });
  await eventually('the room to be held', async () =>
    (await ok<Booking>('GET', `/bookings/${created.id}`, { token })).status === 'PENDING_PAYMENT' || null);
  const order = await eventually('the payment order', async () => {
    const response = await call<{ orderId: string }>('POST', '/payments/create-order',
      { token, body: { bookingId: created.id }, headers: { 'Idempotency-Key': `e2e-order-${created.id}` } });
    return response.status < 300 ? response.body : null;
  });
  const callback = await ok<unknown>('POST', '/payments/demo/pay', { token, body: { orderId: order.orderId } });
  await ok('POST', '/payments/verify', { token, body: callback });
  return eventually('the hotel confirmation', async () => {
    const booking = await ok<Booking>('GET', `/bookings/${created.id}`, { token });
    return booking.status === 'CONFIRMED' ? booking : null;
  });
}

/** Asks for the cancellation (free period: full refund), so the room goes back on sale; does not wait for it. */
export async function cancelBooking(token: string, bookingId: string): Promise<void> {
  const quote = await ok<{ refundAmount: number }>('GET', `/bookings/${bookingId}/cancellation-quote`, { token });
  await ok('POST', `/bookings/${bookingId}/cancel`, {
    token,
    headers: { 'Idempotency-Key': `e2e-cancel-${randomUUID()}` },
    body: { reason: 'End of the accessibility test', expectedRefundAmount: quote.refundAmount },
  });
}
