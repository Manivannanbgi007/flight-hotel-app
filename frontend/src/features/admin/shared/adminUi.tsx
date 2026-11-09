import { useId, useState, type ReactNode, type ThHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, SlidersHorizontal } from 'lucide-react';

import { AccessDeniedIllustration } from '@/components/illustrations';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TableCard } from '@/components/ui/DataTable';
import { TextField } from '@/components/ui/Field';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { PageHeader as PageHeaderView } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import type { Permission } from '@/lib/auth/types';
import { cn } from '@/lib/cn';
import { useCan } from './permissions';
import type { SortState } from './searchState';

/** Shared building blocks of the admin portal pages. */

/** The admin page's h1 with the portal eyebrow, an icon tile in the portal accent, a description and actions. */
export function PageHeader({ title, description, actions, icon, eyebrow = 'Admin portal', children }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
}) {
  return <PageHeaderView eyebrow={eyebrow} icon={icon} title={title} description={description} actions={actions}>{children}</PageHeaderView>;
}

/** The filter bar of a list page: one card with a small "Filters" caption, the same look on every staff list. */
export function FilterCard({ children, className, title = 'Filters' }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card animate-fade-up [animation-delay:60ms] sm:p-5', className)}>
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
        <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-lg bg-role-50 text-role-600 ring-1 ring-inset ring-role-100">
          <SlidersHorizontal className="size-3.5" />
        </span>
        {title}
      </p>
      {children}
    </div>
  );
}

/** A list that is loading: table-shaped skeleton rows and a status text for screen readers ("Loading bookings…"). */
export function ListLoading({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <span role="status" className="sr-only">{label}</span>
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><Skeleton className="h-3 w-1/3" /></div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b border-slate-100 px-4 py-3.5 last:border-0">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-20 sm:block" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Message and support reference of a failed request, next to the form or action that failed. */
export function ProblemAlert({ error, title, className }: { error: unknown; title?: string; className?: string }) {
  const problem = ApiError.from(error);
  return (
    <Alert tone="danger" title={title} className={className}>
      {problem.message}
      {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
    </Alert>
  );
}

/** A list or page that could not be loaded: the reason, the support reference and "Try again". */
export function LoadError({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const problem = ApiError.from(error);
  return <ErrorState title={title} description={problem.message} correlationId={problem.correlationId} onRetry={onRetry} />;
}

/** Shows `children` only with `permission`; otherwise a short "no access" note (no API call is made). */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const allowed = useCan(permission);
  if (allowed) {
    return children;
  }
  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-6 py-12 text-center shadow-card">
      <AccessDeniedIllustration className="w-36" />
      <h1 className="text-lg font-bold tracking-tight text-slate-900">You don't have access to this section</h1>
      <p className="max-w-md text-sm text-slate-600">Your account is missing the permission it needs. Ask another admin if you should have it.</p>
    </section>
  );
}

/**
 * A table in its card (caption for screen readers, then your thead / tbody): scrolls sideways below xl, sticky header
 * row from xl. `scroll`: always scroll sideways, no sticky header (tables that can be wider than the card).
 */
export function TableShell({ caption, children, className, scroll }: {
  caption: string;
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return <TableCard caption={caption} className={className} scroll={scroll}>{children}</TableCard>;
}

export const tdClass = 'px-4 py-3 align-top';

/**
 * Column header that sorts the list: first click descending, then ascending. `aria-sort` tells the current order. The
 * label and its icon sit in a small pill that lights up on hover; an unsorted column shows a faint up/down icon that
 * gets clearer on hover and focus, the sorted one an arrow in the portal accent. Right-aligned columns put the icon
 * first, so the label lines up with the numbers.
 */
export function SortHeader({ label, field, sort, onSort, align = 'left', className, ...rest }: {
  label: string;
  field: string;
  sort: SortState | null;
  onSort: (sort: SortState) => void;
} & { align?: 'left' | 'right' } & Omit<ThHTMLAttributes<HTMLTableCellElement>, 'onClick'>) {
  const active = sort?.field === field;
  const direction = active ? sort.direction : null;
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ChevronsUpDown;
  return (
    <th scope="col" aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
      className={cn(tableStyles.th, align === 'right' && tableStyles.numeric, className)} {...rest}>
      <button
        type="button"
        onClick={() => onSort({ field, direction: active && direction === 'desc' ? 'asc' : 'desc' })}
        className={cn(
          'group/sort -mx-2 -my-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1 uppercase',
          'transition-[background-color,color,box-shadow] duration-(--duration-fast) hover:bg-white/70 hover:text-role-950',
          align === 'right' && 'flex-row-reverse',
          // The sorted column: a white chip on the band.
          active && 'bg-white text-role-950 shadow-xs ring-1 ring-role-200',
        )}
      >
        {label}
        <Icon
          className={cn('size-3.5 shrink-0 transition-colors duration-(--duration-fast)', active
            ? 'text-role-600'
            : 'text-role-300 group-hover/sort:text-role-600 group-focus-visible/sort:text-role-600')}
          aria-hidden="true"
        />
      </button>
    </th>
  );
}

/** Label / value pairs (details pages). Empty values are skipped. */
export function DetailList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid gap-3 text-sm sm:grid-cols-2', className)}>
      {items.filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value], index) => (
        <div key={index} className="min-w-0">
          <dt className="text-slate-500">{label}</dt>
          <dd className="break-words font-medium text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "12 results" for a list (announced politely when it changes). */
export function ResultCount({ count, noun }: { count: number; noun: [string, string] }) {
  return (
    <p className="inline-flex items-center gap-2 self-start rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 shadow-xs ring-1 ring-slate-200 animate-fade-in" role="status">
      <span aria-hidden="true" className="size-2 rounded-full bg-role-500 shadow-[0_0_0_3px_var(--role-100)]" />
      {`${count.toLocaleString('en-IN')} ${count === 1 ? noun[0] : noun[1]}`}
    </p>
  );
}

/** Search field + "Search" button (and "Clear" while a search is active). Give it `key={initial}` to reset it. */
export function SearchBox({ initial, label, placeholder, hint, onSearch }: {
  initial: string;
  label: string;
  placeholder?: string;
  hint?: string;
  onSearch: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const hintId = useId();
  return (
    <form role="search" aria-label={label} className="flex flex-col gap-1" onSubmit={(event) => { event.preventDefault(); onSearch(text.trim()); }}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <TextField label={label} type="search" value={text} onChange={(event) => setText(event.target.value)}
            placeholder={placeholder} aria-describedby={hint ? hintId : undefined} />
        </div>
        <Button type="submit" variant="role"><Search className="size-4" aria-hidden="true" />Search</Button>
        {initial && <Button variant="ghost" onClick={() => { setText(''); onSearch(''); }}>Clear</Button>}
      </div>
      {hint && <p id={hintId} className="text-xs text-slate-500">{hint}</p>}
    </form>
  );
}
