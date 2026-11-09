// Basic load test of the search and booking endpoints (Phase 10). Runs with k6 against the local Docker stack.
//
//   docker run --rm -i --network flight-hotel_default -v "%cd%/tests/load:/scripts" grafana/k6:latest run /scripts/search-and-booking.js
//   (see TESTING_GUIDE.md §6 for PowerShell/Git Bash variants and the environment variables below)
//
// Three scenarios run together:
//   search     30 signed-in users browse: hotel search → rooms of a hotel → flight search, with 1–3 s think time
//   booking     6 users book hotels and flights end to end: quote → booking → DEMO payment → CONFIRMED
//   lastRooms  15 users try to book the same room type on the same night at the same moment, while only 3 rooms are
//              on sale → exactly 3 bookings may hold a room, the others must fail cleanly (no overbooking)
//
// Every virtual user has its own new account (registered and verified in setup through Mailpit), like real users:
// the gateway limits requests per user, so one shared account would only measure the rate limiter.
import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL || 'http://frontend';           // nginx in the compose network (like a browser)
const MAILPIT = __ENV.MAILPIT_URL || 'http://mailpit:8025';
const MANAGER_EMAIL = __ENV.MANAGER_EMAIL || 'manager@flighthotel.local';
const MANAGER_PASSWORD = __ENV.DEMO_USER_PASSWORD;           // only needed for the lastRooms scenario
const ACCOUNTS = Number(__ENV.ACCOUNTS || 30);
const SEARCH_VUS = Number(__ENV.SEARCH_VUS || 30);
const BOOKING_VUS = Number(__ENV.BOOKING_VUS || 6);
const LAST_ROOM_VUS = Number(__ENV.LAST_ROOM_VUS || 15);
const LAST_ROOMS = 3;
const HOLD = __ENV.HOLD || '2m';

const CITIES = ['Goa', 'Mumbai', 'Delhi', 'Bengaluru', 'Jaipur', 'Chennai', 'Kochi', 'Udaipur'];
const ROUTES = [['DEL', 'BOM'], ['BOM', 'BLR'], ['BLR', 'DEL'], ['DEL', 'GOI'], ['MAA', 'CCU'], ['BOM', 'DXB']];

const bookingConfirmed = new Rate('booking_confirmed');
const timeToConfirm = new Trend('time_to_confirm', true);
const lastRoomHolds = new Counter('last_room_holds');
const lastRoomRejected = new Counter('last_room_rejected');
const lastRoomErrors = new Counter('last_room_errors');

export const options = {
  setupTimeout: '6m',
  teardownTimeout: '2m',
  scenarios: {
    search: {
      executor: 'ramping-vus', exec: 'search', startVUs: 0,
      stages: [{ duration: '30s', target: SEARCH_VUS }, { duration: HOLD, target: SEARCH_VUS }, { duration: '15s', target: 0 }],
    },
    booking: { executor: 'constant-vus', exec: 'book', vus: BOOKING_VUS, duration: HOLD, startTime: '20s' },
    lastRooms: { executor: 'per-vu-iterations', exec: 'lastRoom', vus: LAST_ROOM_VUS, iterations: 1, startTime: '45s', maxDuration: '2m' },
  },
  thresholds: {
    // Searching: no errors (a 429 from the rate limiter counts as an error), fast enough under load.
    'http_req_failed{scenario:search}': ['rate<0.01'],
    // Every request of the whole run (expected answers such as "no rooms left" or "payment not ready yet" excluded).
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:hotel-search}': ['p(95)<1500'],
    'http_req_duration{name:hotel-rooms}': ['p(95)<1000'],
    'http_req_duration{name:flight-search}': ['p(95)<1500'],
    // Booking: the API answers quickly; the saga (Kafka, payment, supplier) confirms within seconds.
    'http_req_duration{name:create-booking}': ['p(95)<1500'],
    'http_req_duration{name:create-order}': ['p(95)<1500'],
    booking_confirmed: ['rate>0.95'],
    time_to_confirm: ['p(95)<20000'],
    // Concurrency: exactly as many holds as rooms on sale, every other attempt rejected cleanly.
    last_room_holds: [`count==${LAST_ROOMS}`],
    last_room_errors: ['count==0'],
  },
};

// ------------------------------------------------------------------------------------------------- helpers
const json = { 'Content-Type': 'application/json' };
// Setup registers many accounts: the gateway's auth limit (2/s per client) answers 429 and patient() waits and retries.
// Those 429s are expected and must not count as failed requests.
const setupParams = { headers: json, responseCallback: http.expectedStatuses(200, 201, 202, 204, 429) };
const auth = (token) => ({ ...json, Authorization: `Bearer ${token}` });
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});
/** India date n days from today, YYYY-MM-DD. */
const day = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const plusDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

/** Calls that may meet the rate limiter outside the measured scenarios (setup) wait and try again. */
function patient(fn) {
  for (let i = 0; i < 20; i++) {
    const res = fn();
    if (res.status !== 429) return res;
    sleep(Number(res.headers['Retry-After'] || 1) + Math.random());
  }
  fail('still rate limited after 20 tries');
}

function register(i) {
  const email = `load-${Date.now().toString(36)}-${i}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = 'LoadTest2026pass';
  const reg = patient(() => http.post(`${BASE}/api/auth/register`,
    JSON.stringify({ email, password, firstName: 'Load', lastName: 'Tester', acceptTerms: true }), setupParams));
  if (reg.status !== 202) fail(`register ${reg.status} ${reg.body}`);
  let token = null;
  for (let t = 0; t < 40 && !token; t++) {
    const found = http.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).json('messages') || [];
    if (found.length) {
      const text = http.get(`${MAILPIT}/api/v1/message/${found[0].ID}`).json('Text');
      const m = /verify-email\?token=([A-Za-z0-9_\-.%]+)/.exec(text);
      token = m && decodeURIComponent(m[1]);
    } else {
      sleep(0.5);
    }
  }
  if (!token) fail(`no verification e-mail for ${email}`);
  patient(() => http.post(`${BASE}/api/auth/verify-email`, JSON.stringify({ token }), setupParams));
  const login = patient(() => http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password }), setupParams));
  if (login.status !== 200) fail(`login ${login.status}`);
  return { email, token: login.json('accessToken') };
}

function account(data) {
  return data.accounts[(exec.vu.idInTest - 1) % data.accounts.length];
}

function waitForStatus(token, id, wanted, timeoutS) {
  const end = Date.now() + timeoutS * 1000;
  let last = null;
  while (Date.now() < end) {
    const res = http.get(`${BASE}/api/bookings/${id}`, { headers: auth(token), tags: { name: 'booking-status' } });
    last = res.status === 200 ? res.json('status') : last;
    if (wanted.includes(last)) return last;
    sleep(0.5);
  }
  return last;
}

/**
 * Quote + booking request for one room on [checkIn, checkOut). Returns { id } or the refusing status.
 * "No rooms left" (409) is a correct answer when rooms run out, so it does not count as a failed request; the
 * scenarios count such outcomes themselves (booking_confirmed, last_room_rejected).
 */
const soldOutIsAnAnswer = http.expectedStatuses(200, 201, 202, 409);
function startHotelBooking(acc, hotelId, roomTypeId, ratePlanId, checkIn, checkOut) {
  const quote = http.post(`${BASE}/api/hotels/availability`, JSON.stringify({ hotelId, roomTypeId, ratePlanId,
    stay: { checkIn, checkOut, rooms: 1, adults: 1, children: 0, childAges: [] } }),
  { headers: json, tags: { name: 'hotel-quote' }, responseCallback: soldOutIsAnAnswer });
  if (quote.status !== 200 && quote.status !== 201) return { quoteStatus: quote.status };
  const booking = http.post(`${BASE}/api/bookings/hotel`, JSON.stringify({ quoteId: quote.json('quoteId'),
    contact: { email: acc.email, phone: '+91 98000 00000' }, guests: [{ roomNo: 1, firstName: 'Load', lastName: 'Tester' }] }),
  { headers: { ...auth(acc.token), 'Idempotency-Key': uuid() }, tags: { name: 'create-booking' }, responseCallback: soldOutIsAnAnswer });
  check(booking, { 'booking accepted (202) or sold out (409)': (r) => r.status === 202 || r.status === 409 });
  return booking.status === 202 ? { id: booking.json('id') } : { bookingStatus: booking.status };
}

function payAndConfirm(acc, id, started) {
  if (waitForStatus(acc.token, id, ['PENDING_PAYMENT', 'FAILED'], 30) !== 'PENDING_PAYMENT') return false;
  let order = null;
  for (let i = 0; i < 20 && !order; i++) {   // 409 PAYMENT_NOT_READY until payment-service has the booking
    const res = http.post(`${BASE}/api/payments/create-order`, JSON.stringify({ bookingId: id }),
      { headers: { ...auth(acc.token), 'Idempotency-Key': `order-${id}` }, tags: { name: 'create-order' },
        responseCallback: http.expectedStatuses(200, 201, 409) });
    if (res.status === 200 || res.status === 201) order = res.json('orderId');
    else sleep(0.5);
  }
  if (!order) return false;
  const callback = http.post(`${BASE}/api/payments/demo/pay`, JSON.stringify({ orderId: order }), { headers: auth(acc.token), tags: { name: 'demo-pay' } });
  const verify = http.post(`${BASE}/api/payments/verify`, callback.body, { headers: auth(acc.token), tags: { name: 'verify-payment' } });
  check(verify, { 'payment verified (200)': (r) => r.status === 200 });
  const ok = waitForStatus(acc.token, id, ['CONFIRMED', 'FAILED'], 60) === 'CONFIRMED';
  if (ok) timeToConfirm.add(Date.now() - started);
  return ok;
}

// ------------------------------------------------------------------------------------------------- setup
export function setup() {
  const accounts = [];
  for (let i = 0; i < ACCOUNTS; i++) accounts.push(register(i));
  console.log(`registered ${accounts.length} accounts`);

  let lastRooms = null;
  if (MANAGER_PASSWORD) {
    const m = patient(() => http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: MANAGER_EMAIL, password: MANAGER_PASSWORD }), setupParams));
    const managerToken = m.json('accessToken');
    const hotels = http.get(`${BASE}/api/hotel-manager/hotels`, { headers: auth(managerToken) }).json();
    const hotelId = (Array.isArray(hotels) ? hotels : hotels.content)[0].id;
    // A night far ahead that nobody has booked: put exactly LAST_ROOMS rooms on sale.
    const checkIn = day(between(250, 330));
    const checkOut = plusDays(checkIn, 1);
    const rooms = http.get(`${BASE}/api/hotels/${hotelId}/rooms?checkIn=${checkIn}&checkOut=${checkOut}&rooms=1&adults=1`).json('roomTypes');
    const type = rooms.find((t) => t.available);
    const set = http.put(`${BASE}/api/hotel-manager/hotels/${hotelId}/inventory`,
      JSON.stringify({ roomTypeId: type.roomType.id, from: checkIn, to: checkIn, totalRooms: LAST_ROOMS }), { headers: auth(managerToken) });
    if (set.status !== 200 && set.status !== 204) fail(`set inventory ${set.status} ${set.body}`);
    lastRooms = { hotelId, roomTypeId: type.roomType.id, ratePlanId: type.rates[0].ratePlanId, checkIn, checkOut,
      managerEmail: MANAGER_EMAIL };
    console.log(`lastRooms: ${LAST_ROOMS} rooms of "${type.roomType.name}" on ${checkIn}`);
  } else {
    console.warn('DEMO_USER_PASSWORD not set: the lastRooms scenario is skipped');
  }
  return { accounts, lastRooms };
}

// ------------------------------------------------------------------------------------------------- scenarios
export function search(data) {
  const acc = account(data);
  const checkIn = day(between(10, 120));
  const checkOut = plusDays(checkIn, between(1, 3));
  const hotels = http.get(`${BASE}/api/hotels/search?destination=${pick(CITIES)}&checkIn=${checkIn}&checkOut=${checkOut}&rooms=1&adults=2&sort=${pick(['RECOMMENDED', 'PRICE_ASC', 'RATING_DESC'])}`,
    { headers: auth(acc.token), tags: { name: 'hotel-search' } });
  check(hotels, { 'hotel search 200': (r) => r.status === 200 });
  sleep(between(1, 3));
  const first = hotels.status === 200 ? (hotels.json('content') || [])[0] : null;
  if (first) {
    const rooms = http.get(`${BASE}/api/hotels/${first.id}/rooms?checkIn=${checkIn}&checkOut=${checkOut}&rooms=1&adults=2`,
      { headers: auth(acc.token), tags: { name: 'hotel-rooms' } });
    check(rooms, { 'rooms 200': (r) => r.status === 200 });
    sleep(between(1, 2));
  }
  const [origin, destination] = pick(ROUTES);
  const flights = http.get(`${BASE}/api/flights/search?origin=${origin}&destination=${destination}&departureDate=${day(between(5, 120))}&adults=1&sort=${pick(['PRICE_ASC', 'DURATION_ASC'])}`,
    { headers: auth(acc.token), tags: { name: 'flight-search' } });
  check(flights, { 'flight search 200': (r) => r.status === 200 });
  sleep(between(1, 3));
}

export function book(data) {
  const acc = account(data);
  const started = Date.now();
  let id = null;
  if (exec.scenario.iterationInTest % 2 === 0) {
    // hotel: a random city and night 120–240 days ahead (spread out, so the rooms do not run out)
    const checkIn = day(between(120, 240));
    const checkOut = plusDays(checkIn, 1);
    const found = http.get(`${BASE}/api/hotels/search?destination=${pick(CITIES)}&checkIn=${checkIn}&checkOut=${checkOut}&rooms=1&adults=1`,
      { headers: auth(acc.token), tags: { name: 'hotel-search' } });
    const hotel = (found.json('content') || [])[0];
    if (!hotel) return;
    const rooms = http.get(`${BASE}/api/hotels/${hotel.id}/rooms?checkIn=${checkIn}&checkOut=${checkOut}&rooms=1&adults=1`,
      { headers: auth(acc.token), tags: { name: 'hotel-rooms' } }).json('roomTypes');
    const type = (rooms || []).find((t) => t.available);
    if (!type) return;
    id = startHotelBooking(acc, hotel.id, type.roomType.id, type.rates[0].ratePlanId, checkIn, checkOut).id;
  } else {
    const [origin, destination] = pick(ROUTES);
    const found = http.get(`${BASE}/api/flights/search?origin=${origin}&destination=${destination}&departureDate=${day(between(30, 200))}&adults=1`,
      { headers: auth(acc.token), tags: { name: 'flight-search' } });
    const option = ((found.json('outbound') || {}).options || [])[0];
    if (!option) return;
    const trip = http.post(`${BASE}/api/flights/revalidate`, JSON.stringify({ offerIds: [option.offerId] }), { headers: json, tags: { name: 'flight-revalidate' } });
    if (trip.status !== 200) return;
    const booking = http.post(`${BASE}/api/bookings/flight`, JSON.stringify({ tripOfferId: trip.json('tripOfferId'),
      contact: { email: acc.email, phone: '+91 98000 00000' }, passengers: [{ passengerType: 'ADULT', firstName: 'Load', lastName: 'Tester' }] }),
    { headers: { ...auth(acc.token), 'Idempotency-Key': uuid() }, tags: { name: 'create-booking' } });
    check(booking, { 'booking accepted (202)': (r) => r.status === 202 });
    id = booking.status === 202 ? booking.json('id') : null;
  }
  bookingConfirmed.add(id !== null && payAndConfirm(acc, id, started));
  sleep(1);
}

export function lastRoom(data) {
  const room = data.lastRooms;
  if (!room) return;
  const acc = account(data);
  const started = startHotelBooking(acc, room.hotelId, room.roomTypeId, room.ratePlanId, room.checkIn, room.checkOut);
  if (!started.id) {
    // Rejected before a booking existed (quote or booking request said "no rooms left"): fine, if it is a clean 4xx.
    if ((started.quoteStatus || started.bookingStatus) >= 500) lastRoomErrors.add(1); else lastRoomRejected.add(1);
    return;
  }
  const status = waitForStatus(acc.token, started.id, ['PENDING_PAYMENT', 'FAILED'], 45);
  if (status === 'PENDING_PAYMENT') lastRoomHolds.add(1);
  else if (status === 'FAILED') lastRoomRejected.add(1);
  else lastRoomErrors.add(1);
}

export function teardown(data) {
  // Holds expire on their own; the night keeps LAST_ROOMS rooms (far in the future, demo data only).
  if (data.lastRooms) console.log(`lastRooms night ${data.lastRooms.checkIn}: ${LAST_ROOMS} rooms on sale`);
}
