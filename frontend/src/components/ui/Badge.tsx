import { Children, isValidElement, type HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand' | 'accent' | 'role';

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-info-50 text-info-700 ring-info-200',
  success: 'bg-success-50 text-success-700 ring-success-200',
  warning: 'bg-warning-50 text-warning-700 ring-warning-200',
  danger: 'bg-danger-50 text-danger-700 ring-danger-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  accent: 'bg-accent-50 text-accent-700 ring-accent-200',
  role: 'bg-role-50 text-role-700 ring-role-200',
};

const dots: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  info: 'bg-info-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  brand: 'bg-brand-500',
  accent: 'bg-accent-500',
  role: 'bg-role-500',
};

/**
 * Small status label. `dot` adds a coloured dot before the text (the text always says the status).
 *
 * An icon next to bare text is wrapped in a `display: contents` span: otherwise the icon is the badge's only element
 * child, and icon-colors.css (which cannot see text nodes) takes a `bg-brand-50` / `bg-role-50` badge for an icon tile
 * and recolours its text to the icon's colour, below 4.5:1 (e.g. teal on a teal tint). The layout does not change.
 */
export function Badge({ tone = 'neutral', dot = false, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  dot?: boolean;
}) {
  const parts = Children.toArray(children);
  const iconWithText = parts.some(isValidElement) && parts.some((part) => typeof part === 'string' || typeof part === 'number');
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', tones[tone], className)}
      {...rest}
    >
      {dot && <span aria-hidden="true" className={cn('size-1.5 rounded-full', dots[tone])} />}
      {iconWithText ? <span className="contents">{children}</span> : children}
    </span>
  );
}
