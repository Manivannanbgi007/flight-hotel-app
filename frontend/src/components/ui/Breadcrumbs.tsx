import { Fragment } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/cn';

export interface Crumb {
  label: string;
  /** Leave out for the current page (the last crumb). */
  to?: string;
}

/** "Admin portal › Bookings › Details": where the page sits. The last crumb is the current page. */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              <li className={cn('min-w-0', !last && 'hidden sm:block')}>
                {item.to && !last ? (
                  <Link to={item.to} className="block truncate rounded-md px-1 font-medium text-slate-500 hover:text-slate-900">
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={last ? 'page' : undefined} className="block truncate px-1 font-semibold text-slate-900">
                    {item.label}
                  </span>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className="hidden shrink-0 text-slate-300 sm:block">
                  <ChevronRight className="size-4" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
