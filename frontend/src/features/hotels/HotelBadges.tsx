import { FlaskConical, Star } from 'lucide-react';

import { cn } from '@/lib/cn';

export function StarRating({ stars, className }: { stars: number | null; className?: string }) {
  if (!stars) return null;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-accent-500', className)} role="img" aria-label={`${stars} star hotel`}>
      {Array.from({ length: stars }, (_, i) => (
        <Star key={i} className="size-3.5 fill-current" aria-hidden="true" />
      ))}
    </span>
  );
}

/** "4.4 Very good · 312 reviews". */
export function GuestRating({ rating, reviews, className }: { rating: number | null; reviews: number; className?: string }) {
  if (rating === null) {
    return <span className={cn('text-sm text-slate-500', className)}>No reviews yet</span>;
  }
  const label = rating >= 4.5 ? 'Exceptional' : rating >= 4 ? 'Very good' : rating >= 3.5 ? 'Good' : 'Fair';
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm', className)}>
      <span className="rounded-lg rounded-bl-sm bg-brand-700 px-1.5 py-0.5 text-xs font-bold text-white shadow-xs">{rating.toFixed(1)}</span>
      <span className="font-semibold text-slate-800">{label}</span>
      <span className="text-slate-500">· {reviews} review{reviews === 1 ? '' : 's'}</span>
    </span>
  );
}

/** Demo listings must always be recognisable (requirement: never mix demo and real inventory unlabelled). */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning-700 ring-1 ring-inset ring-warning-200',
        className,
      )}
      title="Sample data for trying out the site. This hotel does not exist."
    >
      <FlaskConical className="size-3" aria-hidden="true" />
      Demo listing
    </span>
  );
}
