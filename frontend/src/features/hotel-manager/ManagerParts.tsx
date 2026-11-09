import { Children, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Search, Star } from 'lucide-react';

import { formatCount } from '@/components/charts';
import { AnimatedNumber } from '@/components/motion/AnimatedNumber';

import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonStyles';
import { DateField } from '@/components/ui/DateField';
import { SelectField } from '@/components/ui/Field';
import { controlClass } from '@/components/ui/fieldStyles';
import { Skeleton } from '@/components/ui/Skeleton';
import { TrendChip, type StatChange } from '@/components/ui/StatCard';
import { ErrorState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { cn } from '@/lib/cn';
import { describeRange, RANGE_LABELS, RANGE_PRESETS, rangeProblem } from './dateRange';
import type { DateRangeQuery, RangeEcho, RangePreset, ReservationStatus } from './operationsTypes';
import { reservationStatusInfo } from './reservationStatus';

/**
 * Why a hotel page could not load. A manager who opens a hotel that is not assigned to them (`403 HOTEL_NOT_ASSIGNED`)
 * gets a clear answer and the way back; other errors show the message, the support reference and (when it can help)
 * a retry.
 */
export function HotelPageError({ error, onRetry, onAutoInterval }: {
  error: unknown;
  onRetry?: () => void;
  /** For `400 INVALID_INTERVAL` (too many points for the range): let the server choose the interval. */
  onAutoInterval?: () => void;
}) {
  const problem = ApiError.from(error);
  if (problem.code === 'HOTEL_NOT_ASSIGNED') {
    return (
      <div className="flex flex-col items-center gap-4">
        <ErrorState
          illustration="locked"
          title="This hotel is not assigned to you"
          description="You can only manage the hotels an administrator has assigned to your account."
          correlationId={problem.correlationId}
        />
        <Link to="/hotel-manager" className={buttonClass({ variant: 'role' })}>My hotels</Link>
      </div>
    );
  }
  if (problem.code === 'INVALID_INTERVAL' && onAutoInterval) {
    return (
      <Alert tone="warning" title="This interval does not fit the range">
        <p>{problem.message}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={onAutoInterval}>Choose the interval automatically</Button>
      </Alert>
    );
  }
  const retryable = problem.status === 0 || problem.status === 408 || problem.status === 429 || problem.status >= 500;
  return (
    <ErrorState
      title={problem.status === 404 ? 'Not found' : undefined}
      description={problem.message}
      correlationId={problem.correlationId}
      onRetry={retryable ? onRetry : undefined}
    />
  );
}

/**
 * The title row of a hotel section page (the layout owns the h1, the hotel's name): an icon tile in the portal accent
 * (tinted per icon by icon-colors.css), the h2, a short description and the page's actions on the right.
 */
export function ManagerPageHeader({ title, description, icon, actions }: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 animate-fade-up">
      <div className="flex min-w-0 items-center gap-3.5">
        {icon && (
          <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-role-50 text-role-600 shadow-xs ring-1 ring-inset ring-role-100">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h2>
          {description && <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-slate-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A compact figure: label and icon tile on top, the value (counts up when it is a number) with an optional trend chip,
 * and a one-line hint. Put several in a `MetricGrid` (a labelled list: screen readers hear how many there are).
 */
export function MetricTile({ label, value, format, icon, change, hint, to, loading = false, className }: {
  label: string;
  value: number | ReactNode;
  format?: (value: number) => string;
  icon?: ReactNode;
  change?: StatChange;
  hint?: ReactNode;
  /** Makes the whole tile a link (e.g. to the filtered list). */
  to?: string;
  loading?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-slate-600">{label}</p>
        {icon && (
          <span aria-hidden="true" className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl bg-role-50 text-role-600 ring-1 ring-inset ring-role-100 [&>svg]:size-[1.125rem]">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        {loading ? (
          <>
            <span role="status" className="sr-only">Loading {label}…</span>
            <Skeleton className="h-8 w-24" />
          </>
        ) : (
          // A number stays on one line; a text value (a room type's name) wraps instead of being cut off.
          <p className={cn('text-2xl font-bold tracking-tight text-slate-900 tabular-nums',
            typeof value === 'number' ? 'truncate' : 'min-w-0 break-words leading-tight')}>
            {typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value}
          </p>
        )}
        {change && !loading && <TrendChip change={change} />}
      </div>
      {hint && <div className="mt-1.5 text-xs leading-relaxed text-slate-500">{hint}</div>}
    </>
  );
  const surface = cn('relative flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card', className);
  return to ? (
    <Link to={to} className={cn(surface, 'group hover-lift pr-9 hover:border-role-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-600')}>
      {body}
      <ArrowUpRight aria-hidden="true" className="absolute bottom-4 right-4 size-4 text-slate-400 transition-colors group-hover:text-role-600" />
    </Link>
  ) : (
    <div className={surface}>{body}</div>
  );
}

const metricColumns = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
  6: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6',
} as const;

/** A row of `MetricTile`s as a labelled list (`label` names it: "Room figures"). Each child is wrapped in a list item. */
export function MetricGrid({ label, columns = 4, wideLast = false, className, children }: {
  label: string;
  columns?: keyof typeof metricColumns;
  /** The last tile spans the whole row (an odd tile out in a two-column grid). */
  wideLast?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  return (
    <ul aria-label={label} className={cn('stagger grid gap-3 sm:gap-4', metricColumns[columns], className)}>
      {items.map((child, index) => (
        <li key={index} className={cn('min-w-0', wideLast && index === items.length - 1 && 'col-span-full')}>{child}</li>
      ))}
    </ul>
  );
}

export interface PillOption<T extends string> {
  value: T;
  label: string;
  /** Shown after the label; `null` while it loads. Leave out for a pill without a count. */
  count?: number | null;
  /** Tailwind background class of a small dot before the label (the status colour). */
  dot?: string;
}

/**
 * Quick filters as pills (one of many): buttons with `aria-pressed`, the chosen one filled with the portal accent, each
 * with an optional count. A labelled list that scrolls sideways on phones.
 */
export function FilterPills<T extends string>({ label, options, value, onChange, className }: {
  label: string;
  options: PillOption<T>[];
  /** The chosen option; `null` when none of the pills is (a filter set elsewhere). */
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <ul aria-label={label} className={cn('-mx-1 flex gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible', className)}>
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <li key={option.value} className="shrink-0">
            <button
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange(option.value)}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-full border pl-3.5 text-sm font-semibold transition-colors duration-(--duration-fast)',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-600',
                option.count === undefined ? 'pr-3.5' : 'pr-1.5',
                pressed
                  ? 'border-role-600 bg-role-600 text-white shadow-sm shadow-role-900/20'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900',
              )}
            >
              {option.dot && <span aria-hidden="true" className={cn('size-2 rounded-full', pressed ? 'bg-white' : option.dot)} />}
              {option.label}{' '}
              {option.count !== undefined && (
                <span className={cn('min-w-7 rounded-full px-2 py-0.5 text-center text-xs font-bold tabular-nums',
                  pressed ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700')}>
                  {option.count === null ? '–' : formatCount(option.count)}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The filter bar of a list: one white card; rows of controls go inside (wrap them as needed). */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card animate-fade-up [animation-delay:60ms] sm:p-4', className)}>
      {children}
    </div>
  );
}

/**
 * A search field with a magnifier inside, "Search" and (while a search is applied) "Clear". The label is for screen
 * readers; the placeholder and the hint say what can be searched. Give it a `key` of the applied text so it resets.
 */
export function SearchBox({ initial, onSearch, placeholder, hint, label = 'Search', className }: {
  initial: string;
  onSearch: (q: string) => void;
  placeholder?: string;
  hint?: string;
  label?: string;
  className?: string;
}) {
  const [text, setText] = useState(initial);
  const id = useId();
  const hintId = useId();
  return (
    <form role="search" className={cn('flex min-w-0 flex-1 basis-80 items-center gap-2', className)}
      onSubmit={(event) => { event.preventDefault(); onSearch(text.trim()); }}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input id={id} type="search" value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder}
          aria-describedby={hint ? hintId : undefined} className={cn(controlClass(false), 'pl-10')} />
      </div>
      <Button type="submit" variant="role">Search</Button>
      {initial && <Button variant="ghost" onClick={() => { setText(''); onSearch(''); }}>Clear</Button>}
      {hint && <span id={hintId} className="sr-only">{hint}</span>}
    </form>
  );
}

/**
 * A titled card of a page: optional icon tile, h3 title, description and actions in the header, the content below.
 * `id` lets the page link to it (`#rooms-tonight`).
 */
export function SectionCard({ title, description, icon, actions, id, className, bodyClassName, children }: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={cn('flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white shadow-card', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-role-50 text-role-600 ring-1 ring-inset ring-role-100 [&>svg]:size-[1.125rem]">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h3 id={headingId} className="text-base font-semibold text-slate-900">{title}</h3>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn('flex-1 p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A small fact with an icon ("Goa", "4-star", "28 rooms"): grey pill, the icon tinted by icon-colors.css. */
export function FactChip({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full bg-slate-100/80 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200/70 [&>svg]:size-3.5', className)}>
      {icon}
      {children}
    </span>
  );
}

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  const info = reservationStatusInfo[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={info.tone} dot>{info.label}</Badge>;
}

/** Five stars with the rating as text for screen readers. */
export function RatingStars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span role="img" aria-label={`${rating} out of 5 stars`} className={cn('inline-flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden="true" className={cn('size-4', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
      ))}
    </span>
  );
}

/**
 * The period of a dashboard or report: a preset, or two dates (applied only when valid: at most 366 days, start on or
 * before end). `shown` is the range the server answered with, so the real dates are always visible. Give it a `key`
 * of the current value so it resets when the URL changes.
 */
export function DateRangeFilter({ value, onChange, shown }: {
  value: DateRangeQuery;
  onChange: (range: DateRangeQuery) => void;
  shown?: RangeEcho | null;
}) {
  const [preset, setPreset] = useState<RangePreset>(value.range);
  const [from, setFrom] = useState(value.from ?? shown?.from ?? '');
  const [to, setTo] = useState(value.to ?? shown?.to ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = useId();

  const choose = (next: RangePreset) => {
    setPreset(next);
    setProblem(null);
    if (next !== 'CUSTOM') onChange({ range: next });
  };
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    const issue = rangeProblem(from, to);
    setProblem(issue);
    if (!issue) onChange({ range: 'CUSTOM', from, to });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-48">
          <SelectField label="Period" value={preset} onChange={(event) => choose(event.target.value as RangePreset)}>
            {RANGE_PRESETS.map((option) => <option key={option} value={option}>{RANGE_LABELS[option]}</option>)}
          </SelectField>
        </div>
        {preset === 'CUSTOM' && (
          <form aria-label="Custom dates" noValidate onSubmit={apply} className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
            <div className="min-w-48 flex-1 sm:w-52 sm:flex-none">
              <DateField label="From" value={from} onChange={setFrom} rangeEnd={to}
                aria-invalid={problem ? true : undefined} aria-describedby={problem ? problemId : undefined} />
            </div>
            <div className="min-w-48 flex-1 sm:w-52 sm:flex-none">
              <DateField label="To" value={to} min={from || undefined} onChange={setTo} rangeStart={from}
                aria-invalid={problem ? true : undefined} aria-describedby={problem ? problemId : undefined} />
            </div>
            <Button type="submit" variant="secondary">Apply</Button>
          </form>
        )}
      </div>
      {problem && <p id={problemId} role="alert" className="text-sm text-danger-600">{problem}</p>}
      {shown && <p className="text-sm text-slate-600">Showing {describeRange(shown)}</p>}
    </div>
  );
}
