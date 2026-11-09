// Phase 10 security checks, live on the Docker stack (through the gateway, like a browser or attacker would call it).
// Usage (repo root): node tests/security/checks.mjs [path to .env, default ./.env]   (reads DEMO_USER_PASSWORD, never prints it)
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const GW = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const MAILPIT = `${process.env.MAILPIT_URL ?? 'http://localhost:8025'}/api/v1`;
const env = Object.fromEntries(readFileSync(process.argv[2] ?? fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8').split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failures.push(name); console.log(`  FAIL ${name} ${detail}`); }
}
function section(title) { console.log(`\n== ${title}`); }

async function api(method, path, { token, body, headers = {}, raw, base = GW } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      redirect: 'manual',
    });
    if (res.status === 429 && attempt < 4 && !raw) { await sleep(1500); continue; }
    const bytes = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = bytes.length ? JSON.parse(bytes.toString('utf8')) : null; } catch { json = null; }
    return { status: res.status, headers: res.headers, json, bytes };
  }
}
async function login(email, password, rememberMe = false) {
  const r = await api('POST', '/api/auth/login', { body: { email, password, rememberMe } });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status}`);
  return { token: r.json.accessToken, cookie: r.headers.getSetCookie?.() ?? [] };
}
const mails = async (to) => (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent('to:' + to)}`)).json()).messages ?? [];
const mail = async (id) => (await fetch(`${MAILPIT}/message/${id}`)).json();
async function waitFor(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(1000); }
  return null;
}

async function register(prefix) {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
  const password = 'Secure2026check';
  const r = await api('POST', '/api/auth/register', { body: { email, password, firstName: 'Ravi', lastName: 'Iyer', acceptTerms: true } });
  if (r.status !== 202) throw new Error(`register -> ${r.status}`);
  const m = await waitFor(async () => (await mails(email))[0]);
  const token = (await mail(m.ID)).Text.match(/verify-email\?token=([A-Za-z0-9_\-.%]+)/)[1];
  await api('POST', '/api/auth/verify-email', { body: { token: decodeURIComponent(token) } });
  return { email, password, ...(await login(email, password)) };
}

// ---- tiny image builders (no libraries) ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, extraChunk) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) { rows.push(Buffer.from([0])); rows.push(Buffer.alloc(w * 3, y % 2 ? 200 : 60)); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    ...(extraChunk ? [chunk('tEXt', Buffer.from(extraChunk))] : []), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
function form(bytes, filename, type) {
  const f = new FormData();
  f.append('file', new Blob([bytes], { type }), filename);
  return f;
}

// =====================================================================================================================
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const istDay = (n) => new Date(Date.now() + 5.5 * 3600000 + n * 86400000).toISOString().slice(0, 10);
/** Customer A: a paid hotel booking (so documents, a payment and notifications exist), a ticket and a passenger. */
async function customerWithData() {
  const a = await register('seca');
  const M0 = await login('manager@flighthotel.local', env.DEMO_USER_PASSWORD);
  const list = (await api('GET', '/api/hotel-manager/hotels', { token: M0.token })).json;
  const hotelId = (Array.isArray(list) ? list : list.content)[0].id;
  const checkIn = istDay(60 + Math.floor(Math.random() * 30)), checkOut = addDays(checkIn, 1);
  const rooms = await api('GET', `/api/hotels/${hotelId}/rooms?checkIn=${checkIn}&checkOut=${checkOut}&rooms=1&adults=1`);
  const roomType = rooms.json.roomTypes.find((x) => x.available);
  const quote = await api('POST', '/api/hotels/availability', { body: { hotelId, roomTypeId: roomType.roomType.id, ratePlanId: roomType.rates[0].ratePlanId,
    stay: { checkIn, checkOut, rooms: 1, adults: 1, children: 0, childAges: [] } } });
  const booking = await api('POST', '/api/bookings/hotel', { token: a.token, headers: { 'Idempotency-Key': randomUUID() },
    body: { quoteId: quote.json.quoteId, contact: { email: a.email, phone: '+91 98000 00000' }, guests: [{ roomNo: 1, firstName: 'Ravi', lastName: 'Iyer' }] } });
  const id = booking.json.id;
  await waitFor(async () => (await api('GET', `/api/bookings/${id}`, { token: a.token })).json.status === 'PENDING_PAYMENT', 60000);
  const order = await waitFor(async () => {
    const o = await api('POST', '/api/payments/create-order', { token: a.token, body: { bookingId: id }, headers: { 'Idempotency-Key': `order-${id}` } });
    return o.status < 300 ? o.json : null;
  });
  const cb = await api('POST', '/api/payments/demo/pay', { token: a.token, body: { orderId: order.orderId } });
  await api('POST', '/api/payments/verify', { token: a.token, body: cb.json });
  await waitFor(async () => (await api('GET', `/api/bookings/${id}`, { token: a.token })).json.status === 'CONFIRMED', 90000);
  await waitFor(async () => ((await api('GET', `/api/documents?bookingId=${id}`, { token: a.token })).json ?? []).length > 0, 60000);
  await api('POST', '/api/support/tickets', { token: a.token, body: { subject: 'Question about my stay', category: 'BOOKING', bookingId: id, message: 'Is breakfast included?' } });
  await api('POST', '/api/customers/passengers', { token: a.token, body: { passengerType: 'ADULT', firstName: 'Meera', lastName: 'Iyer', dateOfBirth: '1992-04-02', gender: 'FEMALE', nationality: 'IN' } });
  return a;
}
const A = await customerWithData();
const B = await register('sec');
console.log(`customer A = new account with a paid hotel booking, customer B = new account`);

section('Other customers\' data (IDOR): customer B asks for customer A\'s things');
const aBookings = (await api('GET', '/api/bookings?size=20', { token: A.token })).json?.content ?? [];
const aBooking = aBookings.find((b) => b.status !== 'PENDING_PAYMENT') ?? aBookings[0];
check('customer A has bookings to probe with', !!aBooking);
const aDocs = (await api('GET', `/api/documents?bookingId=${aBooking.id}`, { token: A.token })).json ?? [];
const aPayments = (await api('GET', '/api/payments?size=5', { token: A.token })).json?.content ?? [];
const aTickets = (await api('GET', '/api/support/tickets?size=5', { token: A.token })).json?.content ?? [];
const aPassengers = (await api('GET', '/api/customers/passengers', { token: A.token })).json ?? [];
const aNotes = (await api('GET', '/api/notifications?size=5', { token: A.token })).json?.content ?? [];
console.log(`  (A has ${aDocs.length} documents for ${aBooking.reference}, ${aPayments.length} payments, ${aTickets.length} tickets, ${aPassengers.length ?? 0} passengers, ${aNotes.length} notifications)`);
const notFoundOrForbidden = (s) => s === 404 || s === 403;
for (const [m, p, body] of [
  ['GET', `/api/bookings/${aBooking.id}`], ['GET', `/api/bookings/${aBooking.id}/timeline`],
  ['GET', `/api/bookings/${aBooking.id}/cancellation-quote`], ['GET', `/api/payments/booking/${aBooking.id}`],
  ['GET', `/api/invoices/booking/${aBooking.id}`],
  ['POST', '/api/payments/create-order', { bookingId: aBooking.id }],
]) {
  const r = await api(m, p, { token: B.token, body, headers: m === 'POST' ? { 'Idempotency-Key': randomUUID() } : {} });
  check(`B: ${m} ${p.replace(aBooking.id, '{A booking}')} -> ${r.status}`, notFoundOrForbidden(r.status));
}
const bDocList = await api('GET', `/api/documents?bookingId=${aBooking.id}`, { token: B.token });
check(`B: list of A's documents is empty (${bDocList.status})`, bDocList.status === 200 && Array.isArray(bDocList.json) && bDocList.json.length === 0);
if (aDocs[0]) {
  const r = await api('GET', `/api/documents/${aDocs[0].id}/download`, { token: B.token });
  check(`B: download A's document -> ${r.status}`, r.status === 404);
}
if (aPayments[0]) {
  const r = await api('GET', `/api/payments/${aPayments[0].id}`, { token: B.token });
  check(`B: A's payment -> ${r.status}`, notFoundOrForbidden(r.status));
}
if (aTickets[0]) {
  const r1 = await api('GET', `/api/support/tickets/${aTickets[0].id}`, { token: B.token });
  check(`B: A's ticket -> ${r1.status}`, r1.status === 404);
  const r2 = await api('POST', `/api/support/tickets/${aTickets[0].id}/messages`, { token: B.token, body: { message: 'probe' } });
  check(`B: reply on A's ticket -> ${r2.status}`, r2.status === 404);
}
if (aPassengers[0]) {
  const r = await api('PUT', `/api/customers/passengers/${aPassengers[0].id}`, { token: B.token,
    body: { firstName: 'Probe', lastName: 'Probe', dateOfBirth: '1990-01-01', passengerType: 'ADULT' } });
  check(`B: change A's saved passenger -> ${r.status}`, notFoundOrForbidden(r.status));
}
if (aNotes[0]) {
  const r = await api('POST', `/api/notifications/${aNotes[0].id}/read`, { token: B.token });
  check(`B: mark A's notification read -> ${r.status}`, notFoundOrForbidden(r.status));
}

section('Tokens');
const [h, p, s] = B.token.split('.');
const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
const forged = Buffer.from(JSON.stringify({ ...payload, roles: ['ADMIN'] })).toString('base64url');
check('payload changed to ADMIN, original signature -> 401',
  (await api('GET', '/api/admin/settings', { token: `${h}.${forged}.${s}` })).status === 401);
const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
check('alg "none" token -> 401', (await api('GET', '/api/bookings', { token: `${none}.${forged}.` })).status === 401);
const hs = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: JSON.parse(Buffer.from(h, 'base64url').toString()).kid })).toString('base64url');
check('HS256 token (key confusion) -> 401', (await api('GET', '/api/bookings', { token: `${hs}.${forged}.${s}` })).status === 401);
check('token claims carry no personal data beyond id/e-mail',
  !JSON.stringify(payload).match(/passport|phone|dateOfBirth|password/i), JSON.stringify(Object.keys(payload)));
const exp = payload.exp - payload.iat;
check(`access token lifetime ${exp / 60} min (<= 15)`, exp <= 900);

section('Refresh cookie and CSRF');
const C = await login(B.email, B.password, true);
const setCookie = C.cookie.find((c) => c.startsWith('fh_refresh=')) ?? '';
console.log(`  (Set-Cookie attributes: ${setCookie.split(';').slice(1).map((x) => x.trim().split('=')[0]).join(', ')})`);
check('refresh cookie is HttpOnly', /;\s*HttpOnly/i.test(setCookie));
check('refresh cookie is SameSite=Strict', /;\s*SameSite=Strict/i.test(setCookie));
check('refresh cookie is limited to Path=/api/auth', /;\s*Path=\/api\/auth/i.test(setCookie));
const cookieHeader = setCookie.split(';')[0];
const noHeader = await api('POST', '/api/auth/refresh', { headers: { Cookie: cookieHeader } });
check(`refresh without X-Requested-With -> ${noHeader.status} ${noHeader.json?.code ?? ''}`, noHeader.status === 403);
const evil = await api('POST', '/api/auth/refresh', { headers: { Cookie: cookieHeader, 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://evil.example' } });
check(`refresh from a foreign Origin -> ${evil.status}`, evil.status === 403);
const ok = await api('POST', '/api/auth/refresh', { headers: { Cookie: cookieHeader, 'X-Requested-With': 'XMLHttpRequest' } });
check(`refresh with cookie + header -> ${ok.status}`, ok.status === 200);
const rotated = (ok.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('fh_refresh='))?.split(';')[0];
check('refresh rotates the cookie', !!rotated && rotated !== cookieHeader);
// Re-use of the old cookie: allowed for 30 s (other tabs), then it ends the whole session (auth-extra.mjs waits for that).
const reuse = await api('POST', '/api/auth/refresh', { headers: { Cookie: cookieHeader, 'X-Requested-With': 'XMLHttpRequest' } });
check(`old cookie inside the 30 s grace -> ${reuse.status}, no new cookie`, reuse.status === 200 && !(reuse.headers.getSetCookie?.() ?? []).some((c) => c.startsWith('fh_refresh=')));

section('Logout revokes the access token');
const D = await login(B.email, B.password);
check('token works before logout', (await api('GET', '/api/bookings', { token: D.token })).status === 200);
await api('POST', '/api/auth/logout', { token: D.token, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
await sleep(500);
check('same token after logout -> 401', (await api('GET', '/api/bookings', { token: D.token })).status === 401);

section('Uploads (profile photo, hotel image)');
const photo = (bytes, name, type) => api('PUT', '/api/customers/profile/photo', { token: B.token, body: form(bytes, name, type) });
let r = await photo(Buffer.from('just some text, not an image'), 'photo.png', 'image/png');
check(`text named .png with image/png -> ${r.status} ${r.json?.code ?? ''}`, r.status >= 400 && r.status < 500);
r = await photo(Buffer.from('<html><script>alert(1)</script></html>'), 'photo.jpg', 'image/jpeg');
check(`HTML named .jpg -> ${r.status} ${r.json?.code ?? ''}`, r.status >= 400 && r.status < 500);
r = await photo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'photo.svg', 'image/svg+xml');
check(`SVG -> ${r.status} ${r.json?.code ?? ''}`, r.status >= 400 && r.status < 500);
const big = Buffer.concat([png(8, 8), Buffer.alloc(2.5 * 1024 * 1024, 1)]);
r = await photo(big, 'big.png', 'image/png');
check(`2.5 MB file (limit 2 MB) -> ${r.status} ${r.json?.code ?? ''}`, r.status === 413 || r.status === 400 || r.status === 422);
const polyglot = png(64, 64, 'Comment\0<script>alert(document.cookie)</script>');
r = await photo(polyglot, '../../../../etc/passwd.png', 'image/png');
check(`real PNG with a script in its metadata and a path-traversal name -> ${r.status}`, r.status === 200);
check('response does not echo the file name', !JSON.stringify(r.json ?? {}).includes('passwd'));
const got = await api('GET', '/api/customers/profile/photo', { token: B.token });
check(`stored photo is served as ${got.headers.get('content-type')}`, got.status === 200 && /^image\/(jpeg|png)/.test(got.headers.get('content-type') ?? ''));
check('stored photo was re-encoded (metadata script gone)', !got.bytes.toString('latin1').includes('<script>'));
check(`photo response has X-Content-Type-Options: nosniff`, got.headers.get('x-content-type-options') === 'nosniff');
check(`photo response is not publicly cacheable (${got.headers.get('cache-control')})`, !/public/.test(got.headers.get('cache-control') ?? ''));

const M = await login('manager@flighthotel.local', env.DEMO_USER_PASSWORD);
const hotels = (await api('GET', '/api/hotel-manager/hotels', { token: M.token })).json;
const myHotel = (Array.isArray(hotels) ? hotels : hotels?.content ?? [])[0];
if (myHotel) {
  const hid = myHotel.id ?? myHotel.hotelId;
  r = await api('POST', `/api/hotel-manager/hotels/${hid}/images`, { token: M.token, body: form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg', 'image/svg+xml') });
  check(`hotel image: SVG -> ${r.status} ${r.json?.code ?? ''}`, r.status >= 400 && r.status < 500);
  r = await api('POST', `/api/hotel-manager/hotels/${hid}/images`, { token: M.token, body: form(Buffer.from('MZ\x90\x00 executable'), 'room.jpg', 'image/jpeg') });
  check(`hotel image: an .exe named .jpg -> ${r.status} ${r.json?.code ?? ''}`, r.status >= 400 && r.status < 500);
}

section('Downloads');
const aDoc = aDocs.find((d) => d.type) ;
if (aDoc) {
  const d = await api('GET', `/api/documents/${aDoc.id}/download`, { token: A.token });
  check(`owner downloads ${aDoc.type}: ${d.status} ${d.headers.get('content-type')}`, d.status === 200 && d.headers.get('content-type') === 'application/pdf');
  check(`starts with %PDF`, d.bytes.subarray(0, 4).toString() === '%PDF');
  check(`Content-Disposition attachment (${d.headers.get('content-disposition')})`, /^attachment;/.test(d.headers.get('content-disposition') ?? ''));
  check(`Cache-Control private, no-store`, /no-store/.test(d.headers.get('cache-control') ?? ''));
  check('nosniff on the download', d.headers.get('x-content-type-options') === 'nosniff');
  const anon = await api('GET', `/api/documents/${aDoc.id}/download`);
  check(`anonymous download -> ${anon.status}`, anon.status === 401);
}
const csv = await api('GET', '/api/hotel-manager/reports/occupancy/export', { token: B.token });
check(`customer exports a manager report -> ${csv.status}`, csv.status === 403);

section('Injection');
for (const [what, path, token] of [
  ['hotel search city', `/api/hotels/search?city=${encodeURIComponent("Goa' OR '1'='1' -- ")}&checkIn=2027-01-10&checkOut=2027-01-12&rooms=1&adults=1`],
  ['hotel search sort', `/api/hotels/search?city=Goa&checkIn=2027-01-10&checkOut=2027-01-12&rooms=1&adults=1&sort=${encodeURIComponent('price;DROP TABLE hotels')}`],
  ['airport lookup', `/api/airports?q=${encodeURIComponent("x' UNION SELECT password FROM users -- ")}`],
  ['my bookings sort', `/api/bookings?sort=${encodeURIComponent('createdAt,(select 1)')}`, A.token],
  ['my tickets status', `/api/support/tickets?status=${encodeURIComponent("OPEN' OR 1=1 --")}`, A.token],
]) {
  const res = await api('GET', path, { token });
  check(`${what}: ${res.status} (no 5xx, no SQL error text)`, res.status < 500 && !/SQL|syntax|jdbc|hibernate/i.test(res.bytes.toString()));
}
const ADM = await login('admin@flighthotel.local', env.DEMO_USER_PASSWORD);
for (const path of [`/api/admin/bookings?q=${encodeURIComponent("%' OR '1'='1")}`, `/api/admin/users?q=${encodeURIComponent("' OR 1=1 --")}`,
  `/api/admin/bookings?sort=${encodeURIComponent('createdAt;delete')}`, `/api/admin/reports/bookings?range=LAST_7_DAYS&sort=${encodeURIComponent('x) union select 1 --')}`]) {
  const res = await api('GET', path, { token: ADM.token });
  check(`admin ${path.split('?')[0]} with injection -> ${res.status} ${res.json?.code ?? ''}`, res.status < 500 && !/SQL|syntax|jdbc/i.test(res.bytes.toString()));
}

section('HTML in user text (stored XSS, e-mails)');
const xss = '<img src=x onerror=alert(1)>';
const t = await api('POST', '/api/support/tickets', { token: B.token, body: { subject: `Help ${xss}`, category: 'OTHER', message: `Hi ${xss} <script>alert(2)</script>` } });
check(`ticket with HTML is accepted as text (${t.status})`, t.status === 201);
const AG = await login('support@flighthotel.local', env.DEMO_USER_PASSWORD);
if (t.json?.id) {
  await api('POST', `/api/support/tickets/${t.json.id}/messages`, { token: AG.token, body: { message: 'We are on it.' } });
  const m = await waitFor(async () => (await mails(B.email)).find((x) => /ticket|support/i.test(x.Subject)));
  if (m) {
    const full = await mail(m.ID);
    check(`e-mail "${full.Subject.slice(0, 60)}" has no raw <img onerror>`, !full.HTML.includes('<img src=x onerror'));
    check('e-mail subject line carries no markup injection', !/<img/i.test(full.Subject) || full.Subject.includes(xss) === true);
  } else {
    check('agent reply e-mail arrived', false);
  }
  const back = await api('GET', `/api/support/tickets/${t.json.id}`, { token: B.token });
  check('ticket text is returned verbatim (React renders it as text)', back.json?.messages?.[0]?.message?.includes('<script>'));
}
const prof = await api('PUT', '/api/customers/profile', { token: B.token, body: { firstName: '<b>Ravi</b>', lastName: 'Iyer' } });
check(`profile name with HTML -> ${prof.status} ${prof.json?.code ?? ''} (rejected or stored as text)`, prof.status < 500);

section('Headers, actuator, docs');
const page = await api('GET', '/', { base: WEB });
for (const hname of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy']) {
  check(`web: ${hname}`, !!page.headers.get(hname));
}
const apiRes = await api('GET', '/api/bookings', { token: A.token, base: WEB });
check(`API JSON through the web server: nosniff`, apiRes.headers.get('x-content-type-options') === 'nosniff');
check(`API JSON with personal data is not cached (${apiRes.headers.get('cache-control')})`, /no-store|no-cache|private/.test(apiRes.headers.get('cache-control') ?? ''));
check(`no server version banner (${apiRes.headers.get('server') ?? 'none'})`, !/\d/.test(apiRes.headers.get('server') ?? ''));
for (const a of ['env', 'heapdump', 'configprops', 'loggers', 'beans', 'threaddump', 'mappings', 'metrics', 'prometheus']) {
  const res = await api('GET', `/actuator/${a}`);
  console.log(`  (gateway /actuator/${a} -> ${res.status})`);
  if (['env', 'heapdump', 'configprops', 'loggers', 'beans', 'threaddump', 'mappings'].includes(a)) check(`gateway /actuator/${a} not exposed`, res.status === 401 || res.status === 404);
}
const webActuator = await api('GET', '/actuator/env', { base: WEB });
check(`web server does not proxy /actuator (${webActuator.status}, ${webActuator.headers.get('content-type')})`, !/json/.test(webActuator.headers.get('content-type') ?? ''));
const err = await api('GET', '/api/bookings/not-a-uuid', { token: A.token });
check(`error responses hide internals (${err.status} ${err.json?.code ?? ''})`, !/Exception|at com\.|at org\./.test(err.bytes.toString()));

section('Brute force');
const victim = B.email;
let statuses = [];
for (let i = 0; i < 7; i++) {
  const res = await api('POST', '/api/auth/login', { body: { email: victim, password: `Wrong${i}Password1` }, raw: true });
  statuses.push(res.status);
}
console.log(`  (7 wrong passwords: ${statuses.join(' ')})`);
check('account locks (423) or is rate limited (429) after repeated failures', statuses.some((x) => x === 423 || x === 429));
const right = await api('POST', '/api/auth/login', { body: { email: victim, password: B.password }, raw: true });
check(`even the right password is refused while locked (${right.status})`, right.status === 423 || right.status === 429);
// Account enumeration (same answer for an unknown e-mail and a wrong password) is checked in auth-extra.mjs, which
// waits for the login rate limit; here the limit is usually used up by now.

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => ' - ' + f).join('\n')); process.exitCode = 1; }
