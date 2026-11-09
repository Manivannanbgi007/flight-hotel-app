import { useId, type ReactNode } from 'react';
import { Armchair, CalendarDays, Pencil, Plane, Users } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { formatShortDate } from '@/lib/format';
import { DemoInventoryBadge } from './FlightBadges';
import { describeTravellers, type FlightSearch } from './searchParams';
import { CABIN_LABELS } from './types';

export interface RouteEnd {
  code: string;
  /** Known once the results arrive. */
  city?: string;
}

/**
 * The top of the flight results: a drifting gradient band with the page title, the search as chips and a plane that
 * flies along a dashed arc from one airport to the other. "Modify search" opens the search form below the band.
 * For a round trip the band shows the direction being chosen and the step.
 */
export function FlightResultsHero({ search, from, to, step, demo, formId, editing, onModify }: {
  search: FlightSearch;
  from: RouteEnd;
  to: RouteEnd;
  /** null for a one-way trip. */
  step: 'outbound' | 'inbound' | null;
  demo: boolean;
  formId: string;
  editing: boolean;
  onModify: () => void;
}) {
  const titleId = useId();
  const title = `${from.city ?? from.code} to ${to.city ?? to.code}`;
  const prefix = step === 'outbound' ? 'Choose your outbound flight' : step === 'inbound' ? 'Choose your return flight' : null;
  const dates = search.returnDate
    ? `${formatShortDate(search.departureDate)} – ${formatShortDate(search.returnDate)}`
    : formatShortDate(search.departureDate);

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'relative isolate overflow-hidden rounded-3xl px-5 py-6 text-white shadow-xl sm:px-8 sm:py-7',
        'bg-[linear-gradient(125deg,var(--role-950),var(--role-800)_45%,var(--role-600)_80%,var(--role-800))] bg-[length:220%_220%] animate-gradient-pan',
      )}
    >
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-grid-faint" />
      {/* The glows are gradients inside the band: no element reaches out of it (under the header, axe would count it). */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(22rem_16rem_at_92%_0%,color-mix(in_srgb,var(--role-400)_45%,transparent),transparent),radial-gradient(20rem_12rem_at_30%_110%,color-mix(in_srgb,var(--color-accent-400)_28%,transparent),transparent)]"
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-inset ring-white/25 backdrop-blur-sm">
            <Plane className="size-3.5 text-white" aria-hidden="true" />
            {step === null ? 'One way' : `Round trip · Step ${step === 'outbound' ? 1 : 2} of 2`}
          </p>
          <h1 id={titleId} className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            {prefix && (
              <>
                <span className="mb-1 block text-base font-semibold tracking-normal text-white/85 sm:text-lg">
                  {prefix}<span className="sr-only">:</span>
                </span>{' '}
              </>
            )}
            {title}
          </h1>
          <ul aria-label="Your search" className="mt-4 flex flex-wrap gap-2">
            <Chip icon={<CalendarDays className="size-4 text-white" aria-hidden="true" />}>{dates}</Chip>
            <Chip icon={<Users className="size-4 text-white" aria-hidden="true" />}>{describeTravellers(search)}</Chip>
            <Chip icon={<Armchair className="size-4 text-white" aria-hidden="true" />}>{CABIN_LABELS[search.cabin]}</Chip>
            {demo && <li className="flex items-center"><DemoInventoryBadge /></li>}
          </ul>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center lg:flex-col lg:items-end">
          <RouteArc key={`${from.code}-${to.code}`} from={from} to={to} />
          <Button variant="secondary" className="shadow-lg" aria-expanded={editing} aria-controls={formId} onClick={onModify}>
            <Pencil className="size-4" aria-hidden="true" /> Modify search
          </Button>
        </div>
      </div>
    </section>
  );
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium ring-1 ring-inset ring-white/20 backdrop-blur-sm">
      {icon}
      {children}
    </li>
  );
}

/** The arc between the airports, in the arc box's own pixels (the plane follows it with `offset-path`). */
const ARC = 'M 8 52 Q 84 -10 160 52';

/**
 * Decorative: the two airport codes joined by a dashed arc that draws itself, a plane that flies up to the top of the
 * arc and cruises there, and a soft pulse on the destination. Under reduced motion all of it is simply there.
 */
function RouteArc({ from, to }: { from: RouteEnd; to: RouteEnd }) {
  const maskId = `route-arc-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2 rounded-2xl bg-white/10 px-4 pb-3 pt-2 ring-1 ring-inset ring-white/20 backdrop-blur-sm sm:gap-3"
    >
      <End end={from} />
      <div className="relative h-[60px] w-[168px]">
        <svg viewBox="0 0 168 60" width="168" height="60" fill="none" className="absolute inset-0 overflow-visible">
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="-4" y="-16" width="176" height="80">
              <path d={ARC} stroke="#fff" strokeWidth="8" strokeLinecap="round" pathLength={1} className="animate-draw-path [stroke-dasharray:1]" />
            </mask>
          </defs>
          <path d={ARC} stroke="#fff" strokeOpacity="0.75" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 6" mask={`url(#${maskId})`} />
          <circle cx="8" cy="52" r="4.5" fill="#fff" />
          <circle cx="160" cy="52" r="7" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.5" />
          <circle cx="160" cy="52" r="4" fill="#fff" />
        </svg>
        {/* The destination's pulse (resting invisible). */}
        <span className="absolute left-[160px] top-[52px] size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/50 opacity-0 animate-halo" />
        {/*
          The plane: on the arc through `offset-path`, nose along the path (lucide's plane points up-right, so +45°).
          The float sits on an unrotated wrapper of the arc box's size, so it bobs straight up and down.
        */}
        <span className="absolute inset-0 animate-float">
          <span
            className="absolute left-0 top-0 flex size-8 items-center justify-center animate-fly-route"
            style={{ offsetPath: `path('${ARC}')`, offsetDistance: '50%', offsetRotate: 'auto 45deg' }}
          >
            <Plane className="size-6 fill-white/25 text-white drop-shadow-[0_4px_8px_rgb(0_0_0/0.35)]" strokeWidth={1.75} />
          </span>
        </span>
      </div>
      <End end={to} align="right" />
    </div>
  );
}

function End({ end, align = 'left' }: { end: RouteEnd; align?: 'left' | 'right' }) {
  return (
    <span className={cn('min-w-0', align === 'right' && 'text-right')}>
      <span className="block text-2xl font-extrabold leading-none tracking-tight sm:text-[1.75rem]">{end.code}</span>
      <span className="mt-1 block truncate text-xs font-medium text-white/85">{end.city ?? '\u00a0'}</span>
    </span>
  );
}
