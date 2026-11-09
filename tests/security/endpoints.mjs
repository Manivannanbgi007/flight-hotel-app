// Phase 10 security check: every endpoint in the services' OpenAPI docs, probed through the gateway.
//  - anonymous: every non-public endpoint must answer 401
//  - customer / hotel manager / support agent: staff endpoints they have no permission for must answer 403
// Path ids are random UUIDs, so nothing real is touched. Authenticated roles only probe staff prefixes, and never
// DELETE without a path id. Usage (repo root): node tests/security/endpoints.mjs [path to .env, default ./.env]   (reads DEMO_USER_PASSWORD, never prints it)
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const GW = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const env = Object.fromEntries(readFileSync(process.argv[2] ?? fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8').split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// mcp-client = the AI assistant API (/api/assistant/**, Phase 11). mcp-server has no gateway route and no OpenAPI doc.
const SERVICES = ['identity', 'hotel', 'flight', 'booking', 'payment', 'notification', 'reporting', 'mcp-client', 'search'];
// gateway public-paths (application.yml), as [method|null, regex]
const PUBLIC = [
  [null, /^\/api\/auth\//], ['GET', /^\/\.well-known\/jwks\.json$/], ['GET', /^\/api\/hotels\//], ['GET', /^\/api\/hotels$/],
  ['POST', /^\/api\/hotels\/availability$/], ['GET', /^\/api\/flights(\/|$)/], ['GET', /^\/api\/airports(\/|$)/],
  ['POST', /^\/api\/flights\/revalidate$/], ['GET', /^\/api\/offers(\/|$)/], ['GET', /^\/api\/reviews\/featured$/],
  ['POST', /^\/api\/payments\/webhook$/], ['POST', /^\/api\/newsletter\//], ['GET', /^\/api\/public\//], ['GET', /^\/api\/search(\/|$)/],
];
const isPublic = (m, p) => PUBLIC.some(([pm, re]) => (!pm || pm === m) && re.test(p));
const STAFF = /^\/api\/(admin|hotel-manager|support\/bookings)(\/|$)/;

async function login(email) {
  const r = await fetch(`${GW}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: env.DEMO_USER_PASSWORD, rememberMe: false }) });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status}`);
  return (await r.json()).accessToken;
}

function concrete(path) {
  return path.replace(/\{([^}]+)\}/g, (_, name) => {
    if (/id$/i.test(name) || /^(id|uuid)$/i.test(name)) return randomUUID();
    if (/reference|code|number/i.test(name)) return 'ZZZ999';
    if (/type|format/i.test(name)) return 'BOOKINGS';
    return 'zz-probe';
  });
}

async function call(method, path, token) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(GW + path, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined,
      redirect: 'manual',
    });
    await res.arrayBuffer().catch(() => {});
    if (res.status === 429 && attempt < 5) { await sleep(1500); continue; }
    return res.status;
  }
}

const ops = [];
for (const s of SERVICES) {
  const doc = await (await fetch(`${GW}/api-docs/${s}-service`)).json();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (item[method]) ops.push({ service: s, method: method.toUpperCase(), path, security: item[method].security });
    }
  }
}
console.log(`${ops.length} operations in ${SERVICES.length} services`);

const tokens = {
  customer: await login('customer@flighthotel.local'),
  manager: await login('manager@flighthotel.local'),
  agent: await login('support@flighthotel.local'),
};

const rows = [];
const problems = [];
for (const op of ops) {
  const url = concrete(op.path);
  const pub = isPublic(op.method, op.path);
  const row = { ...op, url, public: pub };
  row.anon = await call(op.method, url);
  if (!pub && row.anon !== 401) problems.push(`ANON ${op.method} ${op.path} -> ${row.anon} (expected 401)`);
  // The webhook is public but refuses unsigned calls (401 INVALID_WEBHOOK_SIGNATURE): expected.
  if (pub && row.anon === 401 && !(op.method === 'POST' && op.path === '/api/payments/webhook')) {
    problems.push(`PUBLIC-BUT-401 ${op.method} ${op.path}`);
  }
  if (STAFF.test(op.path) && !(op.method === 'DELETE' && !/\{/.test(op.path))) {
    for (const role of Object.keys(tokens)) row[role] = await call(op.method, url, tokens[role]);
  }
  rows.push(row);
  await sleep(60);
}
const out = join(tmpdir(), 'endpoint-access-matrix.json');
writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(`full matrix: ${out}`);
console.log(problems.length ? problems.join('\n') : 'anonymous: every non-public endpoint answered 401, every public one did not');
const staff = rows.filter((r) => r.customer !== undefined);
console.log(`\nstaff endpoints probed with roles: ${staff.length}`);
// Roles that have nothing to do with an area are stopped by the gateway (gateway.role-paths): always 403.
// Inside its own area a role may see 400/404 here (random ids, empty bodies); the services' EndpointSecurityTest
// proves the exact permissions with valid requests.
const roleProblems = [];
for (const r of staff) {
  console.log(`${r.method.padEnd(6)} ${r.path.padEnd(62)} cust=${r.customer} mgr=${r.manager} agent=${r.agent}`);
  if (r.customer !== 403) roleProblems.push(`CUSTOMER ${r.method} ${r.path} -> ${r.customer}`);
  if (/^\/api\/(admin|support\/bookings)(\/|$)/.test(r.path) && r.manager !== 403) roleProblems.push(`HOTEL_MANAGER ${r.method} ${r.path} -> ${r.manager}`);
  if (/^\/api\/hotel-manager(\/|$)/.test(r.path) && r.agent !== 403) roleProblems.push(`SUPPORT_AGENT ${r.method} ${r.path} -> ${r.agent}`);
}
console.log(roleProblems.length ? `\nWRONG ROLE GOT THROUGH:\n${roleProblems.join('\n')}` : '\nroles outside their areas: every call answered 403');
const total = problems.length + roleProblems.length;
console.log(total ? `\n${total} problem(s)` : '\nOK');
process.exitCode = total ? 1 : 0;
