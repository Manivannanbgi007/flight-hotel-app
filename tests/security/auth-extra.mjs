// Phase 10 security checks, part 2: refresh-token reuse after the grace period, account lockout, user enumeration,
// saved passengers (IDOR + passport encryption at rest), report sort injection.
// Usage (repo root): node tests/security/auth-extra.mjs [path to .env, default ./.env]   (reads DEMO_USER_PASSWORD, never prints it)
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GW = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const MAILPIT = `${process.env.MAILPIT_URL ?? 'http://localhost:8025'}/api/v1`;
const env = Object.fromEntries(readFileSync(process.argv[2] ?? fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8').split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failures.push(name); console.log(`  FAIL ${name} ${detail}`); }
}
async function api(method, path, { token, body, headers = {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(GW + path, { method, redirect: 'manual',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 429 && attempt < 8) { await sleep(2000); continue; }
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, headers: res.headers, json };
  }
}
const mails = async (to) => (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent('to:' + to)}`)).json()).messages ?? [];
async function register(prefix) {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
  const password = 'Secure2026check';
  await api('POST', '/api/auth/register', { body: { email, password, firstName: 'Ravi', lastName: 'Iyer', acceptTerms: true } });
  let m;
  for (let i = 0; i < 30 && !m; i++) { m = (await mails(email))[0]; if (!m) await sleep(1000); }
  const text = (await (await fetch(`${MAILPIT}/message/${m.ID}`)).json()).Text;
  await api('POST', '/api/auth/verify-email', { body: { token: decodeURIComponent(text.match(/verify-email\?token=([A-Za-z0-9_\-.%]+)/)[1]) } });
  return { email, password };
}
const login = async (email, password, rememberMe = false) => api('POST', '/api/auth/login', { body: { email, password, rememberMe } });
const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('fh_refresh='))?.split(';')[0];
const refresh = (cookie) => api('POST', '/api/auth/refresh', { headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' } });

console.log('== Refresh token reuse (30 s grace for several tabs, then theft protection)');
const u = await register('secr');
const first = await login(u.email, u.password, true);
const c1 = cookieOf(first);
const r1 = await refresh(c1);
const c2 = cookieOf(r1);
check('refresh rotates the cookie', r1.status === 200 && c2 && c2 !== c1);
const late = await refresh(c1);
check(`old cookie within 30 s (another tab) -> ${late.status}, no new cookie`, late.status === 200 && !cookieOf(late));
console.log('  (waiting 32 s for the grace period to end)');
await sleep(32000);
const stolen = await refresh(c1);
check(`old cookie after the grace period -> ${stolen.status} ${stolen.json?.code ?? ''}`, stolen.status === 401);
const current = await refresh(c2);
check(`...and the whole session is ended: the current cookie -> ${current.status}`, current.status === 401);

console.log('\n== Account lockout and user enumeration');
const v = await register('secl');
const statuses = [];
for (let i = 0; i < 6; i++) { statuses.push((await login(v.email, `Wrong${i}Password1`)).status); await sleep(700); }
console.log(`  (6 wrong passwords: ${statuses.join(' ')})`);
check('the 5th failure locks the account (401 x4, then 423)', statuses.slice(0, 4).every((s) => s === 401) && statuses[4] === 423 && statuses[5] === 423);
const right = await login(v.email, v.password);
check(`the right password is refused while locked -> ${right.status} ${right.json?.code ?? ''}`, right.status === 423 && !!right.json?.details?.lockedUntil);
const unknown = await login(`nobody-${randomUUID().slice(0, 6)}@example.com`, 'Wrong1Password');
const wrongPw = await login(u.email, 'Wrong1Password');
check(`unknown e-mail and wrong password: same status and message (${unknown.status}/${wrongPw.status})`,
  unknown.status === wrongPw.status && unknown.json?.message === wrongPw.json?.message);
const dup = await api('POST', '/api/auth/register', { body: { email: u.email, password: 'Another2026pass', firstName: 'X', lastName: 'Y', acceptTerms: true } });
const fresh = await api('POST', '/api/auth/register', { body: { email: `fresh-${randomUUID().slice(0, 6)}@example.com`, password: 'Another2026pass', firstName: 'X', lastName: 'Y', acceptTerms: true } });
check(`registering a taken e-mail looks the same as a new one (${dup.status}/${fresh.status})`, dup.status === fresh.status && dup.json?.message === fresh.json?.message);
const forgot1 = await api('POST', '/api/auth/forgot-password', { body: { email: u.email } });
const forgot2 = await api('POST', '/api/auth/forgot-password', { body: { email: `nobody-${randomUUID().slice(0, 6)}@example.com` } });
check(`forgot-password: same answer for known and unknown e-mail (${forgot1.status}/${forgot2.status})`, forgot1.status === forgot2.status && forgot1.json?.message === forgot2.json?.message);

console.log('\n== Saved passengers: other customers and encryption at rest');
const a = (await login(u.email, u.password)).json.accessToken;
const bUser = await register('secp');
const b = (await login(bUser.email, bUser.password)).json.accessToken;
const passport = `Q${Math.floor(1e6 + Math.random() * 8e6)}`;
const created = await api('POST', '/api/customers/passengers', { token: a, body: { passengerType: 'ADULT', firstName: 'Meera', lastName: 'Iyer',
  dateOfBirth: '1992-04-02', gender: 'FEMALE', nationality: 'IN', passportNumber: passport, passportExpiry: '2032-01-31', passportCountry: 'IN' } });
check(`A saves a passenger with a passport (${created.status})`, created.status === 201);
check('the response only shows the last 4 digits', !JSON.stringify(created.json).includes(passport) && JSON.stringify(created.json).includes(passport.slice(-4)));
const pid = created.json?.id;
const put = await api('PUT', `/api/customers/passengers/${pid}`, { token: b, body: { passengerType: 'ADULT', firstName: 'Evil', lastName: 'Edit', dateOfBirth: '1990-01-01' } });
check(`B changes A's passenger -> ${put.status}`, put.status === 404 || put.status === 403);
const del = await api('DELETE', `/api/customers/passengers/${pid}`, { token: b });
check(`B deletes A's passenger -> ${del.status}`, del.status === 404 || del.status === 403);
const still = await api('GET', '/api/customers/passengers', { token: a });
check('A\'s passenger is unchanged', still.json?.some((p) => p.id === pid && p.firstName === 'Meera'));
// Read the stored row straight from MySQL (inside the container; the root password stays inside the container).
const sql = `SELECT HEX(passport_number_enc), passport_last4 FROM identity_db.customer_passengers WHERE id = UUID_TO_BIN('${pid}')`;
let row = '';
try {
  row = execFileSync('docker', ['compose', '-f', fileURLToPath(new URL('../../docker-compose.yml', import.meta.url)), 'exec', '-T', 'mysql', 'sh', '-c',
    `mysql -N -uroot -p"$MYSQL_ROOT_PASSWORD" -e "${sql}" 2>/dev/null`], { encoding: 'utf8' }).trim();
} catch (e) { row = 'ERROR ' + e.message.split('\n')[0]; }
const hex = Buffer.from(passport).toString('hex').toUpperCase();
console.log(`  (stored: ${row ? row.slice(0, 24) + '… last4=' + row.split('\t')[1] : 'no row'})`);
check('passport is stored encrypted (no plain text in the column)', row && !row.startsWith('ERROR') && !row.includes(hex) && row.split('\t')[1] === passport.slice(-4));

console.log('\n== Report sort injection');
const adm = (await login('admin@flighthotel.local', env.DEMO_USER_PASSWORD)).json.accessToken;
for (const name of ['bookings', 'payments']) {
  const res = await api('GET', `/api/admin/reports/${name}?range=LAST_7_DAYS&sort=${encodeURIComponent('x) union select 1 --')}`, { token: adm });
  check(`report ${name} with a crafted sort -> ${res.status} ${res.json?.code ?? ''}`, res.status === 400);
  const q = await api('GET', `/api/admin/reports/${name}?range=LAST_7_DAYS&q=${encodeURIComponent("' OR '1'='1")}`, { token: adm });
  check(`report ${name} with a crafted search -> ${q.status} (no 5xx)`, q.status === 200 && q.json?.totalElements !== undefined);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => ' - ' + f).join('\n')); process.exitCode = 1; }
