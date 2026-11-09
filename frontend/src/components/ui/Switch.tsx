import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'type'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * On/off switch for settings that apply at once (no Save button). Give it a name with `aria-label` or
 * `aria-labelledby`; screen readers announce it as a switch that is on or off.
 */
export function Switch({ checked, onCheckedChange, disabled, className, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full shadow-inner transition-colors duration-(--duration-base) ease-out-soft',
        'disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-role-600' : 'bg-slate-300 hover:bg-slate-400',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block size-5 rounded-full bg-white shadow-md ring-1 ring-slate-900/5 transition-transform duration-(--duration-base) ease-spring',
          checked ? 'translate-x-5.5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
