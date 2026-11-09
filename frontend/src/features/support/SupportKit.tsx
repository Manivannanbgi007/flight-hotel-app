import type { ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';

import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

/**
 * The look of the support portal's pages (violet, like the portal): a hero with softly floating shapes, a strip of pill
 * filters with counts, and a few small parts the tables share. Everything here is decoration or layout: the pages keep
 * their own data, headings and labels. All motion stops under reduced motion (`motion-reduce:` and the global rule).
 */

export interface HeroChip {
  label: string;
  /** undefined while loading (a skeleton shows). */
  value: number | string | undefined;
  icon?: LucideIcon;
  /** Draws attention (a pulsing dot): something waits for the team. */
  urgent?: boolean;
}

/** The top of a support page: gradient card, floating shapes, the page's h1, a description, figures and actions. */
export function SupportHero({ icon: Icon, eyebrow = 'Support portal', title, description, chips = [], actions }: {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  description: ReactNode;
  chips?: HeroChip[];
  actions?: ReactNode;
}) {
  return (
    <header className="relative isolate overflow-hidden rounded-3xl bg-[linear-gradient(135deg,var(--role-800),var(--role-600)_58%,var(--role-500))] p-5 text-white shadow-xl shadow-role-600/20 animate-fade-up sm:p-7">
      <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 -z-10 size-64 rounded-full bg-white/10 blur-2xl animate-float motion-reduce:animate-none" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 left-1/3 -z-10 size-72 rounded-full bg-accent-400/20 blur-3xl animate-drift motion-reduce:animate-none" />
      <Icon aria-hidden="true" className="pointer-events-none absolute -bottom-6 right-4 -z-10 size-44 rotate-12 text-white/10 animate-float motion-reduce:animate-none sm:right-10" />
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-4">
          <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/30 backdrop-blur-sm">
            <Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/80">{eyebrow}</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-white/90 sm:text-base">{description}</p>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {chips.length > 0 && (
        <ul aria-label="At a glance" className="stagger mt-5 flex flex-wrap gap-2.5">
          {chips.map((chip) => (
            <li key={chip.label} className="flex items-center gap-2 rounded-2xl bg-white/12 px-3.5 py-2 ring-1 ring-inset ring-white/20 backdrop-blur-sm">
              {chip.icon && <chip.icon aria-hidden="true" className="size-4 text-white/80" />}
              <span className="text-xs font-medium text-white/85">{chip.label}</span>
              {chip.value === undefined
                ? <Skeleton className="h-5 w-8 bg-white/25" />
                : <span className="text-base font-bold tabular-nums">{typeof chip.value === 'number' ? chip.value.toLocaleString('en-IN') : chip.value}</span>}
              {chip.urgent && typeof chip.value === 'number' && chip.value > 0 && (
                <span aria-hidden="true" className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full rounded-full bg-accent-300 opacity-75 animate-pulse-ring motion-reduce:animate-none" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-accent-300" />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

export interface PillTab {
  key: string;
  label: string;
  count?: number;
  icon?: LucideIcon;
}

/** Quick filters as pills with counts. Each is a toggle button (`aria-pressed`); the active one is filled. */
export function PillTabs({ label, tabs, active, onSelect, className }: {
  label: string;
  tabs: PillTab[];
  active: string;
  onSelect: (key: string) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('-mx-1 flex gap-2 overflow-x-auto px-1 pb-1', className)}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(tab.key)}
            className={cn(
              'group inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold',
              'transition-[transform,background-color,color,box-shadow] duration-(--duration-fast) ease-out-soft hover:-translate-y-0.5 motion-reduce:transform-none',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-600',
              selected
                ? 'bg-[linear-gradient(135deg,var(--role-600),var(--role-700))] text-white shadow-md shadow-role-600/25'
                : 'bg-white text-slate-700 shadow-xs ring-1 ring-slate-200 hover:bg-role-50 hover:text-role-800',
            )}
          >
            {tab.icon && <tab.icon aria-hidden="true" className={cn('size-4', selected ? 'text-white' : 'text-role-600')} />}
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', selected ? 'bg-white/20 text-white' : 'bg-role-50 text-role-700')}>
                {tab.count.toLocaleString('en-IN')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A card for a block of a support page: coloured top bar, icon tile, title and a link on the right. */
export function DeskCard({ tone = 'role', icon: Icon, title, count, action, children, headingId }: {
  tone?: 'role' | 'danger' | 'warning';
  icon: LucideIcon;
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  headingId: string;
}) {
  const tones = {
    role: { bar: 'from-role-500 via-role-400 to-role-200', tile: 'from-role-500 to-role-700' },
    danger: { bar: 'from-danger-500 via-danger-200 to-danger-100', tile: 'from-danger-500 to-danger-600' },
    warning: { bar: 'from-warning-500 via-accent-400 to-warning-200', tile: 'from-warning-500 to-accent-500' },
  }[tone];
  return (
    <section aria-labelledby={headingId} className="relative isolate flex min-w-0 flex-col gap-4 overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 shadow-card animate-fade-up sm:p-6">
      <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', tones.bar)} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md ring-1 ring-inset ring-white/20', tones.tile)}>
            <Icon className="size-5" />
          </span>
          <h2 id={headingId} className="text-lg font-bold tracking-tight text-slate-900">
            {title}{count !== undefined && <>{' '}<span className="font-normal text-slate-500">({count})</span></>}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** "See all": a small pill link with an arrow that moves on hover. */
export function SeeAll({ children }: { children: ReactNode }) {
  return (
    <span className="group inline-flex items-center gap-1 rounded-full bg-role-50 px-3 py-1 text-sm font-semibold text-role-700 ring-1 ring-inset ring-role-100 transition-colors hover:bg-role-100">
      {children}
      <ChevronRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
    </span>
  );
}

/** The count line above a table: "12 tickets" in a pill. */
export function ResultCount({ total, noun }: { total: number; noun: readonly [string, string] }) {
  return (
    <p role="status" className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 shadow-xs ring-1 ring-slate-200">
      <span aria-hidden="true" className="size-2 rounded-full bg-role-500" />
      {total} {total === 1 ? noun[0] : noun[1]}
    </p>
  );
}
