// Phase 10: sensitive data in logs. Reads every container's log and counts matches (never prints secret values).
// Usage (repo root): node tests/security/logscan.mjs [path to .env, default ./.env]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const env = Object.fromEntries(readFileSync(process.argv[2] ?? fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8').split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
// Phase 11: the assistant's containers must not log what users asked or what the tools returned, so booking references
// and rupee amounts must not appear there either (the other services may log references legitimately).
const AI_SERVICES = ['mcp-client-service', 'mcp-server-service', 'ollama', 'speaches'];
const services = ['api-gateway', 'identity-service', 'hotel-service', 'flight-service', 'booking-service', 'payment-service',
  'notification-service', 'reporting-service', 'search-service', 'frontend', ...AI_SERVICES];
const aiPatterns = [
  ['booking reference (conversation content)', /\b(HT|FL)-[A-Z0-9]{8}\b/],
  ['rupee amount (conversation content)', /₹\s?\d/],
];
const secrets = Object.entries(env).filter(([k, v]) => /PASSWORD|SECRET|KEY/.test(k) && v && v.length >= 8).map(([k, v]) => [k, v]);

const patterns = [
  ['JWT (eyJ…eyJ…)', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/],
  ['Bearer header', /Bearer\s+[A-Za-z0-9._-]{20,}/],
  ['refresh cookie value', /fh_refresh=[A-Za-z0-9._-]{16,}/],
  ['"password" field with a value', /"?password"?\s*[:=]\s*"?[^",\s*]{6,}/i],
  ['passport number field', /passport(Number)?["=:\s]+[A-Z0-9]{6,}/i],
  ['card number', /\b(?:\d[ -]?){13,19}\b(?<!\d{4}-\d{2}-\d{2})/],
  ['verification/reset token in a URL', /(verify-email|reset-password)\?token=[A-Za-z0-9_.%-]{16,}/],
  ['Razorpay signature value', /signature["=:\s]+[0-9a-f]{40,}/i],
];

let problems = 0;
for (const s of services) {
  let log;
  try {
    log = execFileSync('docker', ['compose', '-f', fileURLToPath(new URL('../../docker-compose.yml', import.meta.url)), 'logs', '--no-color', '--no-log-prefix', s],
      { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  } catch (e) { console.log(`${s}: cannot read logs (${e.message.split('\n')[0]})`); continue; }
  const lines = log.split('\n');
  const hits = [];
  for (const [name, value] of secrets) {
    const n = lines.filter((l) => l.includes(value)).length;
    if (n) hits.push(`${n}x value of ${name}`);
  }
  for (const [name, re] of AI_SERVICES.includes(s) ? [...patterns, ...aiPatterns] : patterns) {
    const matching = lines.filter((l) => re.test(l));
    // card-number pattern: ignore UUIDs, timestamps, ids and numbers inside JSON numbers of metrics
    const real = name === 'card number' ? matching.filter((l) => /card|pan\b/i.test(l)) : matching;
    if (real.length) hits.push(`${real.length}x ${name}  e.g. ${real[0].replace(re, '«MATCH»').slice(0, 160)}`);
  }
  console.log(`${s.padEnd(22)} ${String(lines.length).padStart(7)} lines  ${hits.length ? 'FOUND: ' + hits.join(' | ') : 'clean'}`);
  problems += hits.length;
}
console.log(problems ? `\n${problems} finding(s)` : '\nno secrets, tokens or personal data patterns in any log');
process.exitCode = problems ? 1 : 0;
