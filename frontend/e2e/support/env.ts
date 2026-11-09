import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Where the end-to-end tests point. Defaults: the Docker Compose stack (nginx frontend on :3000, Mailpit on :8025).
 *   E2E_BASE_URL     the app, e.g. http://localhost:5173 for `npm run dev` (its /api is proxied to the gateway)
 *   E2E_MAILPIT_URL  Mailpit's web/API address
 *   DEMO_USER_PASSWORD  password of the seeded demo accounts; read from the repository's .env when not set
 *   E2E_ENV_FILE     another .env file to read DEMO_USER_PASSWORD from
 */
export const BASE_URL = trimSlash(process.env.E2E_BASE_URL ?? 'http://localhost:3000');
/** The API through the app's own origin (nginx or Vite proxy /api to the gateway), like the browser uses it. */
export const API_URL = `${BASE_URL}/api`;
export const MAILPIT_URL = trimSlash(process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025');

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

let dotEnv: Record<string, string> | null = null;

function readDotEnv(): Record<string, string> {
  if (dotEnv) {
    return dotEnv;
  }
  const file = process.env.E2E_ENV_FILE ?? fileURLToPath(new URL('../../../.env', import.meta.url));
  const values: Record<string, string> = {};
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
      if (match?.[1] && !line.trimStart().startsWith('#')) {
        values[match[1]] = (match[2] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  } catch {
    // No .env file: only the environment variable can provide the password.
  }
  dotEnv = values;
  return values;
}

/** Password of the seeded demo accounts. Never print or store it. */
export function demoPassword(): string {
  const value = process.env.DEMO_USER_PASSWORD || readDotEnv().DEMO_USER_PASSWORD;
  if (!value) {
    throw new Error('DEMO_USER_PASSWORD is not set: export it or put it in the repository .env (see .env.example).');
  }
  return value;
}

export const DEMO_ACCOUNTS = {
  admin: 'admin@flighthotel.local',
  customer: 'customer@flighthotel.local',
  manager: 'manager@flighthotel.local',
  support: 'support@flighthotel.local',
} as const;
