import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

/**
 * Centered card on a soft sky background with drifting clouds, inside the site layout: the newsletter link pages.
 * (Sign-in, register, forgot / reset password and verify e-mail use the full-screen `AuthShell` instead.)
 *
 * Optional extras (all decorative or additive):
 * - `illustration`: a drawing at the top of the card (state screens: "Check your inbox", "Email confirmed");
 * - `icon`: a small tile above the title (forms);
 * - `aside`: a second column next to the card on large screens (below it on phones), e.g. what an account gives you;
 * - `width="lg"`: a wider card for two-column forms.
 */
export function AuthCard({ title, subtitle, children, footer, illustration, icon, aside, width = 'md' }: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  illustration?: ReactNode;
  icon?: ReactNode;
  aside?: ReactNode;
  width?: 'md' | 'lg';
}) {
  const card = (
    <div className="flex w-full flex-col">
      <Card variant="elevated" className="relative overflow-hidden rounded-3xl p-6 shadow-xl animate-fade-up sm:p-8">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-gradient-brand" />
        {illustration && (
          <div aria-hidden="true" className="mb-2 flex justify-center">
            <div className="animate-float">{illustration}</div>
          </div>
        )}
        {icon && !illustration && (
          <span
            aria-hidden="true"
            className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-gradient-brand text-white shadow-glow ring-1 ring-white/30"
          >
            {icon}
          </span>
        )}
        <h1 className={cn('text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]', illustration && 'text-center')}>{title}</h1>
        {subtitle && (
          <p className={cn('mt-2 text-sm leading-relaxed text-slate-600 sm:text-base', illustration && 'text-center')}>{subtitle}</p>
        )}
        <div className="mt-6">{children}</div>
      </Card>
      {footer && <div className="mt-6 text-center text-sm text-slate-700">{footer}</div>}
    </div>
  );

  return (
    <div className="relative isolate overflow-hidden bg-gradient-sky">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-mesh" />
        <div className="absolute left-[6%] top-12 h-10 w-40 rounded-full bg-white/60 blur-xl animate-drift" />
        <div className="absolute right-[6%] top-1/3 h-10 w-36 rounded-full bg-white/50 blur-xl animate-drift [animation-delay:-6s]" />
        <div className="absolute bottom-24 left-[18%] h-8 w-32 rounded-full bg-white/50 blur-xl animate-drift [animation-delay:-11s]" />
      </div>
      {aside ? (
        // The card comes first in the reading order (the h1); on large screens the aside is drawn on its left.
        <section className="mx-auto grid w-full max-w-5xl items-start gap-8 px-4 py-10 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:gap-12">
          <div className="lg:order-2">{card}</div>
          <div className="lg:order-1 lg:pt-6">{aside}</div>
        </section>
      ) : (
        <section className={cn('mx-auto flex w-full flex-col px-4 py-10 sm:py-16', width === 'lg' ? 'max-w-xl' : 'max-w-md')}>
          {card}
        </section>
      )}
    </div>
  );
}
