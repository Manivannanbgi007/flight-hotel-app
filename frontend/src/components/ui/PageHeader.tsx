import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The top of a page: optional eyebrow (section or portal name), the page's h1, a description and actions on the right
 * (they wrap under the title on phones). One per page.
 */
export function PageHeader({ title, description, eyebrow, actions, icon, className, children }: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  /** A small icon tile before the title. */
  icon?: ReactNode;
  className?: string;
  /** Extra content under the description (filters, tabs). */
  children?: ReactNode;
}) {
  return (
    <header className={cn('flex flex-col gap-4 animate-fade-up', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--role-500),var(--role-700))] text-white shadow-lg shadow-role-600/25 ring-1 ring-inset ring-white/20"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-role-700">{eyebrow}</p>}
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
            {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** A titled block inside a page (h2, or h3 with `as` for a page whose layout owns the h1 and h2), with optional description and actions. */
export function Section({ title, description, actions, id, as: Heading = 'h2', className, children }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  as?: 'h2' | 'h3';
  className?: string;
  children: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Heading id={headingId} className={cn('font-bold tracking-tight text-slate-900', Heading === 'h2' ? 'text-lg sm:text-xl' : 'text-base sm:text-lg')}>{title}</Heading>
          {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
