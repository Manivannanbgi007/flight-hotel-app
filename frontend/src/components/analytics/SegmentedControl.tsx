import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** Why the option is disabled (read with it, also shown as a hint by the caller). */
  description?: string;
}

/**
 * A small one-of-many switch (interval, measure): native radio buttons, so arrow keys, Tab and screen readers work as
 * usual. The selected segment is filled with the portal's accent (white on role-600 passes AA).
 */
export function SegmentedControl<T extends string>({ legend, legendHidden = false, options, value, onChange, hint, size = 'md', className }: {
  legend: ReactNode;
  /** Keep the legend for screen readers only. */
  legendHidden?: boolean;
  options: SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Small text after the legend ("Automatic"). */
  hint?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <legend className={cn('mb-1.5 text-sm font-semibold text-slate-800', legendHidden && 'sr-only')}>
        {legend}
        {hint && <span className="ml-2 text-xs font-medium text-slate-500">{hint}</span>}
      </legend>
      <div className="inline-flex max-w-full flex-wrap gap-1 self-start rounded-xl bg-white p-1 shadow-xs ring-1 ring-slate-200">
        {options.map((option) => {
          const descriptionId = option.description ? `${name}-${option.value}-why` : undefined;
          return (
            <label key={option.value} className={cn('relative', option.disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                disabled={option.disabled}
                aria-describedby={descriptionId}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'block rounded-lg font-semibold transition-colors duration-(--duration-fast)',
                  size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
                  'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                  'peer-checked:bg-role-600 peer-checked:text-white peer-checked:shadow-sm peer-checked:hover:bg-role-600',
                  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-role-600',
                  'peer-disabled:text-slate-500 peer-disabled:line-through peer-disabled:hover:bg-transparent',
                )}
              >
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
      {options.filter((option) => option.description).map((option) => (
        <span key={option.value} id={`${name}-${option.value}-why`} className="sr-only">{option.description}</span>
      ))}
    </fieldset>
  );
}
