import type { ReactNode } from 'react';
import { CalendarDays, Hourglass, Users } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { DemoBadge } from '@/features/hotels/HotelBadges';
import { describeGuests } from '@/features/hotels/searchParams';
import type { Quote } from '@/features/hotels/types';
import { cn } from '@/lib/cn';
import { formatMoney, formatShortDate } from '@/lib/format';
import { formatCountdown } from '@/lib/useCountdown';

/** "Price held for 12:34" (or "This price has expired."), announced politely as it changes state. */
export function PriceHold({ remaining, className }: { remaining: number; className?: string }) {
  const expired = remaining <= 0;
  return (
    <p
      role="status"
      className={cn(
        'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ring-1 ring-inset',
        expired ? 'bg-danger-50 text-danger-700 ring-danger-200' : 'bg-warning-50 text-warning-700 ring-warning-200',
        className,
      )}
    >
      <Hourglass className="size-4 shrink-0" aria-hidden="true" />
      {expired ? 'This price has expired.' : `Price held for ${formatCountdown(remaining)}`}
    </p>
  );
}

/**
 * The stay being booked, next to the guest form: hotel, room, dates, guests, the total and how long the price is
 * held. Sticks below the header on large screens; comes after the form on phones.
 */
export function StaySummaryCard({ quote, remaining, note, footer }: {
  quote: Quote;
  /** Seconds the price is still held. */
  remaining: number;
  note?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="h-fit overflow-hidden lg:sticky lg:top-24">
      <div className="border-b border-slate-100 bg-gradient-sky px-5 py-4">
        <p className="text-xs font-bold uppercase tracking-wider text-role-700">Your stay</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold tracking-tight text-slate-900">{quote.hotelName}</h2>
          {quote.demo && <DemoBadge />}
        </div>
        <p className="mt-0.5 text-sm text-slate-600">{quote.roomTypeName} · {quote.ratePlanName}</p>
      </div>
      <div className="p-5">
        <p className="flex items-center gap-2 text-sm text-slate-700">
          <CalendarDays className="size-4 shrink-0 text-role-600" aria-hidden="true" />
          {formatShortDate(quote.checkIn)} to {formatShortDate(quote.checkOut)} · {quote.nights} night{quote.nights === 1 ? '' : 's'}
        </p>
        <p className="mt-1.5 flex items-center gap-2 text-sm text-slate-700">
          <Users className="size-4 shrink-0 text-role-600" aria-hidden="true" />
          {describeGuests(quote)}
        </p>
        <p className="mt-4 flex items-baseline justify-between gap-3 rounded-xl bg-role-50/70 px-3 py-2.5 text-base font-bold text-slate-900 ring-1 ring-inset ring-role-100">
          <span>Total</span><span className="tabular-nums">{formatMoney(quote.total, quote.currency, true)}</span>
        </p>
        {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
        <PriceHold remaining={remaining} className="mt-4" />
        {footer}
      </div>
    </Card>
  );
}
