import type { ReactNode } from 'react';
import { CalendarClock, Search } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { ButtonLink } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/StateViews';
import type { ApiError } from '@/lib/api/apiError';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { formatCountdown } from '@/lib/useCountdown';
import type { PriceLine } from './types';

/** The trip offer could not be loaded: expired (404) or another problem with a retry, and a way back to the search. */
export function TripProblem({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <PageContainer width="md">
      <div className="mx-auto max-w-xl py-6">
        {error.status === 404 ? (
          <ErrorState illustration="lost" title="This fare has expired" description="Fares are kept for 20 minutes. Please search again." />
        ) : (
          <ErrorState description={error.message} correlationId={error.correlationId} onRetry={onRetry} />
        )}
        <p className="mt-6 text-center">
          <ButtonLink to="/flights" variant="secondary">
            <Search className="size-4" aria-hidden="true" /> Search flights
          </ButtonLink>
        </p>
      </div>
    </PageContainer>
  );
}

/** The page shape (header, cards, summary) while the trip offer loads. */
export function TripPageLoading({ label }: { label: string }) {
  return (
    <PageContainer width="xl">
      <span role="status" className="sr-only">{label}</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-9 w-72 max-w-full" />
      <Skeleton className="mt-3 h-4 w-56 max-w-full" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </PageContainer>
  );
}

/** A card's h2 with a small icon tile. */
export function SectionTitle({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <h2 className={cn('flex items-center gap-2.5 text-base font-bold text-slate-900', className)}>
      <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
        {icon}
      </span>
      {children}
    </h2>
  );
}

/** The server's price lines and the total (exactly as the API calculated them). */
export function PriceLines({ lines, total, currency }: { lines: PriceLine[]; total: number; currency: string }) {
  return (
    <dl className="mt-4 flex flex-col gap-2 text-sm">
      {lines.map((line, index) => (
        <div key={`${line.label}-${index}`} className="flex justify-between gap-3 text-slate-700">
          <dt>{line.label}</dt>
          <dd className="tabular-nums">{formatMoney(line.amount, currency, true)}</dd>
        </div>
      ))}
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-dashed border-slate-200 pt-3 text-slate-900">
        <dt className="text-base font-bold">Total</dt>
        <dd className="text-xl font-bold tracking-tight">{formatMoney(total, currency, true)}</dd>
      </div>
    </dl>
  );
}

/**
 * How long the re-priced fare is kept. The ticking time is a timer (not read out every second); "expired" is
 * announced once.
 */
export function FareCountdown({ remaining }: { remaining: number }) {
  const expired = remaining <= 0;
  const urgent = !expired && remaining < 5 * 60;
  if (expired) {
    return (
      <p role="status" className="mt-4 flex items-center gap-2 rounded-xl bg-danger-50 px-3 py-2 text-sm font-semibold text-danger-700 ring-1 ring-inset ring-danger-200">
        <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
        This fare has expired.
      </p>
    );
  }
  return (
    <p
      role="timer"
      className={cn(
        'mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ring-1 ring-inset',
        urgent ? 'bg-warning-50 text-warning-700 ring-warning-200' : 'bg-slate-50 text-slate-700 ring-slate-200',
      )}
    >
      <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
      {`Fare kept for ${formatCountdown(remaining)}`}
    </p>
  );
}
