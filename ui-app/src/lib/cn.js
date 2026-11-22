import { clsx } from 'clsx';

/** Joins class names, skipping falsy values: cn('px-2', isActive && 'bg-brand-600'). */
export function cn(...values) {
  return clsx(values);
}
