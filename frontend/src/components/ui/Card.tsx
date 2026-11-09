import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type CardVariant = 'default' | 'elevated' | 'outline' | 'glass' | 'tinted';

const variants: Record<CardVariant, string> = {
  default: 'border border-slate-200/70 bg-white shadow-card',
  elevated: 'border border-slate-100 bg-white shadow-lg',
  outline: 'border border-slate-200 bg-white',
  glass: 'glass border border-white/60 shadow-lg',
  tinted: 'border border-role-100 bg-role-50/60',
};

/**
 * Surface for grouped content: rounded-2xl, a soft layered shadow. `interactive` adds the hover lift (use it on cards
 * that are links or contain one main action).
 */
export function Card({ className, variant = 'default', interactive = false, ...rest }: HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  interactive?: boolean;
}) {
  return <div className={cn('rounded-2xl', variants[variant], interactive && 'hover-lift', className)} {...rest} />;
}

/** Title row of a card: heading (h2 by default), optional description and actions on the right. */
export function CardHeader({ title, description, actions, as: Heading = 'h2', className, id }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <Heading id={id} className="text-base font-semibold text-slate-900">{title}</Heading>
        {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
