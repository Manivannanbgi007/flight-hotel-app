import type { ReactNode } from 'react';
import { BedDouble, Hourglass, LogIn, LogOut, Moon, ShieldCheck } from 'lucide-react';

import { useHotelPhoto } from '@/features/hotels/useHotelPhoto';
import { cn } from '@/lib/cn';
import { formatDateTime, formatShortDate } from '@/lib/format';
import { formatCountdown } from '@/lib/useCountdown';

/**
 * Building blocks of the two checkout screens (the held hotel price, /hotels/quote/:id, and the payment step,
 * /my-trips/:id/pay). The motion (index.css: gradient-pan, draw-x, pop, halo) is decorative, and under reduced motion every
 * part simply appears in its final state.
 */

/** From two minutes left the timer turns orange. */
const URGENT_SECONDS = 120;

/**
 * How long a price or a held room is kept: a ring that empties as the time runs out, "Price held for 12:34" and the
 * clock time it ends. The running text is a `timer` (screen readers read it when they reach it; it is not announced
 * every second); the "expired" sentence is announced once, in a status region that is there from the start.
 */
export function HoldTimer({ remaining, total, label, deadline, note, expiredText, expiredNote, className }: {
  /** Seconds left (0 = over). */
  remaining: number;
  /** Seconds the hold lasts in all, for the ring. */
  total: number;
  /** "Price held for", "Pay within". */
  label: string;
  /** When it ends (ISO). */
  deadline: string | null;
  /** After "Until 15:35." while it runs. */
  note?: string;
  expiredText: string;
  /** Under the expired sentence. */
  expiredNote?: string;
  className?: string;
}) {
  const expired = remaining <= 0;
  const urgent = !expired && remaining <= URGENT_SECONDS;
  const fraction = expired ? 0 : Math.min(1, remaining / Math.max(total, 1));
  const radius = 23;
  const circumference = 2 * Math.PI * radius;
  const until = deadline ? formatDateTime(deadline).slice(-5) : null;
  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-2xl p-3 ring-1 ring-inset transition-colors duration-(--duration-slow)',
        expired ? 'bg-danger-50 ring-danger-200' : urgent ? 'bg-warning-50 ring-warning-200' : 'bg-role-50/70 ring-role-100',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('relative flex size-14 shrink-0 items-center justify-center',
          expired ? 'text-danger-600' : urgent ? 'text-warning-600' : 'text-role-600')}
      >
        <svg viewBox="0 0 56 56" className="absolute inset-0 size-full -rotate-90">
          <circle cx="28" cy="28" r={radius} fill="none" strokeWidth="4" className="stroke-white" />
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            className="stroke-current transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
        <Hourglass className={cn('size-5 text-current', urgent && 'animate-pulse')} />
      </span>
      <div className="min-w-0">
        {!expired && <p role="timer" className="text-[0.9375rem] font-bold tabular-nums text-slate-900">{label} {formatCountdown(remaining)}</p>}
        <p role="status" className="text-[0.9375rem] font-bold text-danger-700 empty:hidden">{expired && expiredText}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
          {expired ? expiredNote : [until && `Until ${until}.`, note].filter(Boolean).join(' ')}
        </p>
      </div>
    </div>
  );
}

/**
 * Check-in → nights → check-out as a small timeline: two date cards joined by a dashed line that draws itself, with a
 * moon in the middle. `compact` for the narrow summary column.
 */
export function StayTimeline({ checkIn, checkOut, checkInTime, checkOutTime, nights, compact = false, className }: {
  checkIn: string;
  checkOut: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  nights: number;
  compact?: boolean;
  className?: string;
}) {
  const dash = 'h-0.5 flex-1 origin-left animate-draw-x bg-[repeating-linear-gradient(90deg,var(--role-300)_0_6px,transparent_6px_11px)]';
  return (
    <dl className={cn('grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2', !compact && 'sm:gap-3', className)}>
      <TimelineEnd icon={<LogIn />} term="Check-in" date={checkIn} time={checkInTime ? `from ${checkInTime.slice(0, 5)}` : null} compact={compact} />
      <div className="flex flex-col items-center">
        <dt className="sr-only">Length of stay</dt>
        <dd className="flex flex-col items-center">
          <span aria-hidden="true" className={cn('flex items-center', compact ? 'w-12' : 'w-14 sm:w-24')}>
            <span className={dash} />
            <span className="mx-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-role-600 text-white shadow-glow animate-pop [animation-delay:450ms]">
              <Moon className="size-3.5" />
            </span>
            <span className={cn(dash, '[animation-delay:650ms]')} />
          </span>
          <span className="mt-1.5 whitespace-nowrap text-xs font-semibold text-role-700">
            {nights} night{nights === 1 ? '' : 's'}
          </span>
        </dd>
      </div>
      <TimelineEnd icon={<LogOut />} term="Check-out" date={checkOut} time={checkOutTime ? `until ${checkOutTime.slice(0, 5)}` : null} compact={compact} />
    </dl>
  );
}

function TimelineEnd({ icon, term, date, time, compact }: { icon: ReactNode; term: string; date: string; time: string | null; compact: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-2xl bg-slate-50/80 ring-1 ring-inset ring-slate-200/70', compact ? 'px-3 py-2.5' : 'p-3 sm:p-4')}>
      <dt className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-current">
        <span aria-hidden="true" className="flex text-role-600">{icon}</span>
        {term}
      </dt>
      <dd className={cn('mt-1 font-bold tracking-tight text-slate-900', compact ? 'text-sm' : 'text-base sm:text-lg')}>{formatShortDate(date)}</dd>
      {time && <dd className="text-xs text-slate-600 sm:text-sm">{time}</dd>}
    </div>
  );
}

/**
 * The top of a stay card: a slowly drifting gradient band in the role colour with the card's title on it (white text,
 * never over the photo, so it reads the same on any picture) and the hotel's photo as a tilted postcard that straightens
 * on hover. Without a photo (none, still loading, offline) the postcard shows a bed. `size="sm"` for the summary column.
 */
export function StayCover({ slug, size = 'md', className, children }: {
  slug: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
  children: ReactNode;
}) {
  const photo = useHotelPhoto(slug);
  return (
    <div
      className={cn(
        'relative isolate flex items-end justify-between gap-4 overflow-hidden text-white',
        'bg-[linear-gradient(125deg,var(--role-950),var(--role-800)_45%,var(--role-600)_80%,var(--role-800))] bg-[length:220%_220%] animate-gradient-pan',
        className,
      )}
    >
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-grid-faint" />
      <div aria-hidden="true" className="absolute -right-12 -top-20 -z-10 size-64 rounded-full bg-role-400/35 blur-3xl" />
      <div aria-hidden="true" className="absolute -bottom-24 left-10 -z-10 size-56 rounded-full bg-accent-400/15 blur-3xl" />
      <div className="min-w-0 flex-1">{children}</div>
      <div
        aria-hidden="true"
        className={cn(
          'relative shrink-0 self-center rounded-2xl bg-white p-1.5 shadow-2xl ring-1 ring-white/40 animate-pop [animation-delay:200ms]',
          'rotate-3 transition-transform duration-(--duration-slow) ease-out-soft hover:rotate-0 hover:scale-105',
          size === 'sm' ? 'mr-4 w-20' : 'mr-5 w-24 sm:mr-7 sm:w-40',
        )}
      >
        {photo ? (
          <img src={photo.thumbUrl || photo.url} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" decoding="async" />
        ) : (
          <span className="flex aspect-[4/3] w-full items-center justify-center rounded-xl bg-gradient-to-br from-role-100 to-role-50 text-role-600">
            <BedDouble className={cn('text-current', size === 'sm' ? 'size-6' : 'size-8')} />
          </span>
        )}
      </div>
    </div>
  );
}

/** A shield in a frosted tile with soft rings growing out of it (decorative; for dark bands). */
export function SecureSeal({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('relative flex size-16 shrink-0 items-center justify-center', className)}>
      <span className="absolute inset-0 rounded-2xl bg-white/25 opacity-0 animate-halo" />
      <span className="absolute inset-0 rounded-2xl bg-white/25 opacity-0 animate-halo [animation-delay:1.2s]" />
      <span className="relative flex size-16 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/30 backdrop-blur-sm animate-pop">
        <ShieldCheck className="size-8 text-white" />
      </span>
    </span>
  );
}
