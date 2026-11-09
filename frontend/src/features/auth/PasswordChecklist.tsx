import { Check, Circle } from 'lucide-react';

import { cn } from '@/lib/cn';
import { checkPassword } from './passwordRules';

/** Live checklist under a new-password field. */
export function PasswordChecklist({ password, email, id }: { password: string; email?: string | null; id?: string }) {
  // Nothing typed yet: every rule is still open (an empty password is not "not common").
  const rules = checkPassword(password, email).map((rule) => ({ ...rule, passed: password !== '' && rule.passed }));
  return (
    <ul id={id} className="grid gap-x-3 gap-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-xs ring-1 ring-slate-200/70 sm:grid-cols-2" aria-label="Password rules">
      {rules.map((rule) => (
        <li key={rule.id} className={cn('flex items-center gap-1.5 transition-colors duration-(--duration-base)', rule.passed ? 'font-medium text-success-700' : 'text-slate-600')}>
          {rule.passed ? (
            <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-full bg-success-600 text-white animate-scale-in">
              <Check className="size-3" strokeWidth={3} />
            </span>
          ) : (
            <Circle className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
          )}
          <span>
            {rule.label}
            <span className="sr-only">{rule.passed ? ' (met)' : ' (not met yet)'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
