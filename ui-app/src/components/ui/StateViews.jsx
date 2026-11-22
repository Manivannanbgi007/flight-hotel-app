import { RotateCcw } from 'lucide-react';

import {
  AccessDeniedIllustration,
  EmptyInboxIllustration,
  LostIllustration,
  NoResultsIllustration,
  StormIllustration,
} from '@/components/illustrations';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Skeleton } from './Skeleton';

const drawings = {
  inbox: (className) => <EmptyInboxIllustration className={className} />,
  search: (className) => <NoResultsIllustration className={className} />,
  lost: (className) => <LostIllustration className={className} />,
  error: (className) => <StormIllustration className={className} />,
  locked: (className) => <AccessDeniedIllustration className={className} />,
};

function Drawing({ illustration, compact }) {
  if (illustration === 'none' || illustration === null || illustration === false) {
    return null;
  }
  const size = compact ? 'w-28' : 'w-40 sm:w-44';
  if (typeof illustration === 'string' && illustration in drawings) {
    return drawings[illustration](size);
  }
  return <>{illustration}</>;
}

/** Shown when a list or page has no data yet. */
export function EmptyState({ title, description, action, illustration = 'inbox', compact = false, className }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 text-center animate-fade-in',
        compact ? 'px-4 py-8' : 'px-6 py-12',
        className,
      )}
    >
      <Drawing illustration={illustration} compact={compact} />
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      {description && <p className="max-w-md text-sm leading-relaxed text-slate-600">{description}</p>}
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Shown when loading failed. Offers a retry and the support reference when given. */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  correlationId,
  illustration = 'error',
  compact = false,
  className,
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-2xl border border-danger-200 bg-gradient-to-b from-danger-50 to-white text-center animate-fade-in',
        compact ? 'px-4 py-8' : 'px-6 py-10',
        className,
      )}
    >
      <Drawing illustration={illustration} compact={compact} />
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      {description && <p className="max-w-md text-sm leading-relaxed text-slate-700">{description}</p>}
      {correlationId && (
        <p className="rounded-full bg-white px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
          Support reference: {correlationId}
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * Shown while a section loads: skeleton rows with a shimmer and a status text for screen readers. Use FullPageLoader
 * for a whole page.
 */
export function LoadingState({ label = 'Loading…', rows = 3, className }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <span role="status" className="sr-only">
        {label}
      </span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card"
        >
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
