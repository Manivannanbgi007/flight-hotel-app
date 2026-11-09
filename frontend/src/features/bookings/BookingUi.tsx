import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BedDouble, Plane } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

/**
 * Building blocks of the booking, payment and My Trips pages (and the parts the staff portals reuse). Accents use the
 * `role-*` tokens, so they follow the portal colour (brand on customer pages).
 */

/** A titled card: an icon tile, the h2 title and optional actions on the right. */
export function DetailCard({ title, icon, actions, headingId, className, children }: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Id of the h2, for `aria-labelledby` on a surrounding region. */
  headingId?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Card className={cn('p-5 sm:p-6', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="flex min-w-0 items-center gap-2.5 text-base font-bold tracking-tight text-slate-900">
          {icon && <IconTile size="sm">{icon}</IconTile>}
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </Card>
  );
}

/** A soft square holding an icon (decorative). */
export function IconTile({ children, size = 'md', className }: { children: ReactNode; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center bg-role-50 text-role-600 ring-1 ring-inset ring-role-100',
        size === 'sm' && 'size-8 rounded-lg [&_svg]:size-4',
        size === 'md' && 'size-11 rounded-xl [&_svg]:size-5',
        size === 'lg' && 'size-14 rounded-2xl [&_svg]:size-7',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The trip's type as an icon with a text alternative ("Flight" / "Hotel"), in a tile. */
export function TripTypeIcon({ type, size = 'md' }: { type: 'HOTEL' | 'FLIGHT'; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center bg-gradient-to-br from-role-50 to-white text-role-600 ring-1 ring-inset ring-role-100',
        size === 'sm' && 'size-9 rounded-lg [&_svg]:size-4',
        size === 'md' && 'size-12 rounded-2xl [&_svg]:size-6',
        size === 'lg' && 'size-14 rounded-2xl [&_svg]:size-7',
      )}
    >
      {type === 'FLIGHT' ? <Plane role="img" aria-label="Flight" /> : <BedDouble role="img" aria-label="Hotel" />}
    </span>
  );
}

/** A `dt`/`dd` pair of a fact list (`<dl className={factGrid}>`). */
export function Fact({ label, children, className, strong = false }: { label: ReactNode; children: ReactNode; className?: string; strong?: boolean }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={cn('mt-0.5 break-words', strong ? 'text-base font-bold text-slate-900' : 'text-sm font-semibold text-slate-800')}>{children}</dd>
    </div>
  );
}

/** Two columns of facts from `sm` up. */
export const factGrid = 'mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2';

/**
 * The placeholder of a booking page while it loads: a heading block, then the main column and the summary card.
 * The status text is for screen readers (and lets the e2e helpers wait for it).
 */
export function BookingPageSkeleton({ label = 'Loading…', aside = true }: { label?: string; aside?: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <span role="status" className="sr-only">{label}</span>
      <Skeleton className="h-9 w-full max-w-md rounded-xl" />
      <Skeleton className="h-5 w-full max-w-xs" />
      <div className={cn('grid gap-6', aside && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
        {aside && <Skeleton className="h-72 w-full rounded-2xl" />}
      </div>
    </div>
  );
}

/**
 * A decorative illustration at one of three fixed widths: the wrapper is sized and the drawing (given no width class)
 * fills it, so every booking page uses the same three sizes.
 */
export function Art({ children, size = 'md', className }: { children: ReactNode; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('mx-auto shrink-0', size === 'sm' ? 'w-28' : size === 'lg' ? 'w-44' : 'w-36', className)}>
      {children}
    </div>
  );
}

/** An icon in a soft circle with a turning ring around it, for "we are working on it" states (decorative). */
export function WaitingRing({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="relative flex size-20 shrink-0 items-center justify-center">
      <span className="absolute inset-0 rounded-full border-4 border-role-100" />
      <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-role-600 [animation-duration:1.1s]" />
      <span className="flex size-12 items-center justify-center rounded-full bg-role-50 text-role-600 [&_svg]:size-6">{children}</span>
    </span>
  );
}

/** A small "← Back" link above a page title. The visible text is the whole accessible name. */
export function BackLink({ children, to }: { children: ReactNode; to: string }) {
  return (
    <Link to={to} className="inline-flex items-center rounded-md text-sm font-semibold text-role-700 hover:underline">
      {children}
    </Link>
  );
}
