import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type HeroTone = 'ocean' | 'sky';

/**
 * The illustrated band at the top of a public or customer landing page (home, flights, hotels, offers, help, about,
 * the dashboard greeting). It holds the page's only h1.
 *
 * - `tone="ocean"`: the dark dusk gradient with white text (contrast checked on its darkest half, where the text sits).
 * - `tone="sky"`: the light sky gradient with slate text.
 * - `illustration`: a decorative drawing on the right from md up (floats gently; still under reduced motion).
 * - `children`: content that overlaps the hero's lower edge, usually the search card.
 */
export function PageHero({
  eyebrow,
  title,
  description,
  illustration,
  actions,
  tone = 'ocean',
  size = 'md',
  className,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Decorative only (the illustrations are aria-hidden); never put information in it. */
  illustration?: ReactNode;
  actions?: ReactNode;
  tone?: HeroTone;
  /** `lg` for the home page; `sm` for compact page tops. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Overlaps the bottom edge of the band (search cards). */
  children?: ReactNode;
}) {
  const ocean = tone === 'ocean';
  const overlap = Boolean(children);
  return (
    <>
      <section
        className={cn(
          'relative isolate overflow-hidden',
          ocean ? 'bg-gradient-dusk text-white' : 'bg-gradient-sky text-slate-900',
          className,
        )}
      >
        <HeroBackdrop ocean={ocean} />
        <div
          className={cn(
            'mx-auto grid max-w-7xl items-center gap-8 px-4 sm:px-6 md:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]',
            size === 'lg' ? 'pt-12 sm:pt-16 lg:pt-20' : size === 'sm' ? 'pt-8 sm:pt-10' : 'pt-10 sm:pt-14',
            overlap ? (size === 'lg' ? 'pb-28 sm:pb-32' : 'pb-24 sm:pb-28') : size === 'sm' ? 'pb-8 sm:pb-10' : 'pb-12 sm:pb-16',
          )}
        >
          <div className="min-w-0 animate-fade-up">
            {eyebrow && (
              <p
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ring-1',
                  ocean ? 'bg-white/10 text-accent-100 ring-white/20 backdrop-blur-sm' : 'bg-white/80 text-brand-700 ring-brand-100',
                )}
              >
                {eyebrow}
              </p>
            )}
            <h1
              className={cn(
                'font-bold tracking-tight text-balance',
                eyebrow && 'mt-4',
                size === 'lg' ? 'text-3xl sm:text-5xl lg:text-6xl' : size === 'sm' ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl lg:text-5xl',
                ocean ? 'text-white' : 'text-slate-900',
              )}
            >
              {title}
            </h1>
            {description && (
              <p className={cn('mt-4 max-w-2xl text-base leading-relaxed sm:text-lg', ocean ? 'text-brand-50' : 'text-slate-700')}>
                {description}
              </p>
            )}
            {actions && <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>}
          </div>
          {illustration && (
            <div aria-hidden="true" className="relative hidden justify-self-end md:block">
              <div className={cn('absolute inset-6 -z-10 rounded-full blur-2xl', ocean ? 'bg-brand-400/30' : 'bg-white/70')} />
              <div className="animate-fade-in">
                <div className="animate-float">{illustration}</div>
              </div>
            </div>
          )}
        </div>
      </section>
      {overlap && <div className="relative z-10 mx-auto -mt-20 max-w-7xl px-4 sm:-mt-24 sm:px-6">{children}</div>}
    </>
  );
}

/** A faint grid, soft glows and two drifting clouds behind the hero text (decorative). */
function HeroBackdrop({ ocean }: { ocean: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className={cn('absolute inset-0', ocean ? 'bg-grid-faint' : 'bg-grid-light')} />
      <div className={cn('absolute -left-24 -top-24 size-80 rounded-full blur-3xl', ocean ? 'bg-brand-500/30' : 'bg-brand-200/60')} />
      <div className={cn('absolute -right-16 top-10 size-72 rounded-full blur-3xl', ocean ? 'bg-accent-500/20' : 'bg-accent-200/50')} />
      {/* Violet and cyan depth glows on the right half only (never behind the text). */}
      <div className={cn('absolute right-[18%] -bottom-24 hidden size-96 rounded-full blur-3xl md:block', ocean ? 'bg-violet-500/25' : 'bg-violet-200/40')} />
      <div className={cn('absolute right-[-6rem] top-1/3 hidden size-72 rounded-full blur-3xl md:block', ocean ? 'bg-cyan-400/15' : 'bg-cyan-100/50')} />
      {/* Two faint cloud glows, only beside the illustration (md+), never behind the text. */}
      <div className={cn('absolute right-[30%] top-[14%] hidden h-10 w-40 rounded-full blur-xl animate-drift md:block', ocean ? 'bg-white/[0.07]' : 'bg-white/60')} />
      <div className={cn('absolute bottom-[22%] right-[6%] hidden h-8 w-32 rounded-full blur-xl animate-drift [animation-delay:-7s] md:block', ocean ? 'bg-white/[0.06]' : 'bg-white/50')} />
      {ocean &&<div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-brand-950/30 to-transparent" />}
    </div>
  );
}
