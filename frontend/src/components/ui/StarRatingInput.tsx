import { forwardRef, useId, useState, type ReactNode } from 'react';
import { Star } from 'lucide-react';

import { cn } from '@/lib/cn';

/** What each number of stars means, in words (shown next to the stars). */
const RATING_WORDS: readonly string[] = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

const STARS = [1, 2, 3, 4, 5] as const;
const starName = (n: number) => `${n} star${n === 1 ? '' : 's'}`;

export interface StarRatingInputProps {
  label: ReactNode;
  /** 1–5, or 0 when nothing is chosen yet. */
  value: number;
  onChange: (value: number) => void;
  onBlur?: () => void;
  /** Radio group name (one per form). */
  name: string;
  error?: string;
  hint?: ReactNode;
  disabled?: boolean;
}

/**
 * 1 to 5 stars as a real radio group: Tab reaches it, the arrow keys change the rating, and screen readers announce
 * "4 stars, 4 of 5" inside the group named by `label`. The ref goes to the first star, so a form can focus it on an
 * error.
 */
export const StarRatingInput = forwardRef<HTMLInputElement, StarRatingInputProps>(function StarRatingInput(
  { label, value, onChange, onBlur, name, error, hint, disabled },
  ref,
) {
  const id = useId();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const messageId = `${id}-message`;

  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={error || hint ? messageId : undefined} disabled={disabled}>
      <legend className="text-sm font-semibold text-slate-800">{label}</legend>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex" onMouseLeave={() => setHover(0)}>
          {STARS.map((n) => (
            <label key={n} className="relative cursor-pointer p-0.5 transition-transform duration-(--duration-fast) ease-spring hover:scale-110" onMouseEnter={() => setHover(n)}>
              <input
                ref={n === 1 ? ref : undefined}
                type="radio"
                name={name}
                value={n}
                checked={value === n}
                onChange={() => onChange(n)}
                onBlur={onBlur}
                aria-invalid={error ? true : undefined}
                className="peer sr-only"
              />
              <span className="sr-only">{starName(n)}</span>
              <Star
                aria-hidden="true"
                className={cn(
                  'size-8 rounded-lg transition-colors duration-(--duration-fast) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-brand-600',
                  n <= shown ? 'fill-accent-300 text-accent-500' : 'fill-transparent text-slate-300',
                )}
              />
            </label>
          ))}
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-medium text-slate-700" aria-hidden="true">
          {shown ? `${starName(shown)}: ${RATING_WORDS[shown]}` : 'Not rated yet'}
        </span>
      </div>
      {error ? (
        <p id={messageId} className="text-sm font-medium text-danger-600">{error}</p>
      ) : (
        hint && <p id={messageId} className="text-xs text-slate-500">{hint}</p>
      )}
    </fieldset>
  );
});

/** Read-only stars for a rating (whole or average, e.g. 4.4), with a text alternative: "4.4 out of 5 stars". */
export function StarScore({ rating, size = 'sm', className }: { rating: number; size?: 'sm' | 'md'; className?: string }) {
  const filled = Math.round(rating);
  const text = Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
  return (
    <span role="img" aria-label={`${text} out of 5 stars`} className={cn('inline-flex items-center gap-0.5', className)}>
      {STARS.map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={cn(size === 'md' ? 'size-5' : 'size-4', n <= filled ? 'fill-accent-300 text-accent-500' : 'fill-slate-100 text-slate-300')}
        />
      ))}
    </span>
  );
}
