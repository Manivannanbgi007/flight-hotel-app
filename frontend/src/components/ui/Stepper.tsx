import { Check } from 'lucide-react';

import { cn } from '@/lib/cn';

export interface StepperStep {
  label: string;
  /** Short line under the label (hidden on phones). */
  description?: string;
}

/**
 * Progress through a multi-step flow (booking: search → details → review → pay). An ordered list: the current step
 * has `aria-current="step"`, finished steps say "completed" to screen readers. On phones a single line
 * "Step 2 of 4: Guest details" with a progress bar replaces the row.
 */
export function Stepper({ steps, current, label = 'Progress', className }: {
  steps: StepperStep[];
  /** Zero-based index of the current step. */
  current: number;
  label?: string;
  className?: string;
}) {
  const active = steps[current];
  return (
    <nav aria-label={label} className={className}>
      <div className="sm:hidden" aria-hidden="true">
        <p className="text-sm font-semibold text-slate-900">
          Step {Math.min(current + 1, steps.length)} of {steps.length}{active ? `: ${active.label}` : ''}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-role-600 transition-[width] duration-(--duration-slow) ease-out-soft"
            style={{ width: `${(Math.min(current + 1, steps.length) / Math.max(steps.length, 1)) * 100}%` }} />
        </div>
      </div>
      <ol className="sr-only sm:not-sr-only sm:flex sm:items-start">
        {steps.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
          return (
            <li key={step.label} aria-current={state === 'current' ? 'step' : undefined} className="flex flex-1 items-start gap-3 last:flex-none">
              <div className="flex shrink-0 flex-col items-center">
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full text-sm font-bold transition-colors duration-(--duration-base)',
                    state === 'done' && 'bg-role-600 text-white',
                    state === 'current' && 'bg-white text-role-700 ring-4 ring-role-100 outline-2 outline-role-600',
                    state === 'upcoming' && 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
                  )}
                >
                  {state === 'done' ? <Check className="size-4" aria-hidden="true" /> : index + 1}
                </span>
              </div>
              <div className="min-w-0 pt-1.5">
                <p className={cn('text-sm font-semibold', state === 'upcoming' ? 'text-slate-500' : 'text-slate-900')}>
                  {step.label}
                  {state === 'done' && <span className="sr-only"> (completed)</span>}
                </p>
                {step.description && <p className="mt-0.5 hidden text-xs text-slate-500 lg:block">{step.description}</p>}
              </div>
              {index < steps.length - 1 && (
                <span aria-hidden="true" className={cn('mx-2 mt-4 hidden h-0.5 flex-1 rounded-full sm:block', index < current ? 'bg-role-600' : 'bg-slate-200')} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
