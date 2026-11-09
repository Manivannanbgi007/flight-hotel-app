import type { Portal } from '@/lib/auth/portals';
import type { DevAccount } from './devAccountsData';

export type { DevAccount } from './devAccountsData';

/**
 * Development only. The accounts are loaded only when the build was made with `VITE_DEV_ACCOUNTS=true` (the Vite dev
 * server reads it from `.env.development`; the Docker image takes the build argument `VITE_DEV_ACCOUNTS`, default
 * `false`). Vite replaces the flag by a constant, so in a normal production build the `import()` below is removed and the
 * data file is not part of the bundle or of its source map: no test email, no password. There is no API behind this:
 * nothing sends test credentials from a server.
 *
 * The accounts exist only in a database whose services run with `DEV_SEED_ENABLED=true` (never in the prod profile).
 */
export async function loadDevAccounts(portal: Portal): Promise<readonly DevAccount[]> {
  if (import.meta.env.VITE_DEV_ACCOUNTS === 'true') {
    const { DEV_ACCOUNTS } = await import('./devAccountsData');
    return DEV_ACCOUNTS[portal];
  }
  return [];
}
