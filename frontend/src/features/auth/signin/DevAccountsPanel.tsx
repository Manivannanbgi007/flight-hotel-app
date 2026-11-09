import { useEffect, useState } from 'react';
import { FlaskConical, KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import type { Portal } from '@/lib/auth/portals';
import { loadDevAccounts, type DevAccount } from './devAccounts';

/**
 * "Development Test Accounts" on a sign-in page: the seeded accounts of THIS portal only, each with a button that fills
 * the form. It never submits: the person reviews the values and presses Log in. Renders nothing unless the build was made
 * for development (`devAccounts.ts`). Compact (one row per account) so it does not push the form's own links away.
 */
export function DevAccountsPanel({ portal, onUse }: { portal: Portal; onUse: (account: { email: string; password: string }) => void }) {
  const [accounts, setAccounts] = useState<readonly DevAccount[]>([]);
  useEffect(() => {
    let active = true;
    void loadDevAccounts(portal).then((loaded) => {
      if (active) setAccounts(loaded);
    });
    return () => {
      active = false;
    };
  }, [portal]);
  if (accounts.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="dev-accounts-title" className="mt-8 rounded-2xl border border-dashed border-warning-300 bg-warning-50/60 p-3.5">
      <h2 id="dev-accounts-title" className="flex items-center gap-2 text-sm font-bold text-warning-800">
        <FlaskConical className="size-4" aria-hidden="true" />
        Development Test Accounts
      </h2>
      <p className="mt-0.5 text-xs text-warning-800">Development builds only, where the development seed is switched on.</p>
      <ul className="mt-3 flex flex-col divide-y divide-warning-100 overflow-hidden rounded-xl bg-white ring-1 ring-warning-200">
        {accounts.map((account) => (
          <li key={account.email} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0 text-xs leading-relaxed">
              <p className="truncate text-sm font-semibold text-slate-900">{account.label}</p>
              <p className="truncate text-slate-700">
                <span className="sr-only">Email </span>
                <code className="font-mono">{account.email}</code>
              </p>
              <p className="truncate text-slate-600">
                <span className="text-slate-500">Password </span>
                <code className="font-mono">{account.password}</code>
              </p>
            </div>
            <Button type="button" size="sm" variant="secondary" aria-label={`Use credentials of ${account.email}`} onClick={() => onUse(account)}>
              <KeyRound className="size-4" aria-hidden="true" />
              Use
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
