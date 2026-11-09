import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router';

import { cn } from '@/lib/cn';

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Small count or badge after the label. */
  badge?: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

type TabsVariant = 'underline' | 'pills';

const tabClass = (variant: TabsVariant, selected: boolean) =>
  cn(
    'inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-semibold transition-colors duration-(--duration-fast)',
    'disabled:cursor-not-allowed disabled:opacity-50',
    variant === 'underline'
      ? cn('-mb-px border-b-2 px-3 py-2.5', selected ? 'border-role-600 text-role-700' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900')
      : cn('rounded-full px-3.5 py-1.5', selected ? 'bg-white text-role-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'),
  );

const listClass = (variant: TabsVariant) =>
  variant === 'underline'
    ? 'flex gap-1 overflow-x-auto border-b border-slate-200'
    : 'inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-slate-100 p-1';

/**
 * Tabs inside one page (WAI-ARIA tabs): Tab moves into the list, arrow keys / Home / End move between tabs and select
 * them, the panel follows. Controlled (`value` + `onChange`) or not (`defaultValue`). For tabs that change the URL use
 * TabLinks.
 */
export function Tabs({ items, value, defaultValue, onChange, label, variant = 'underline', className }: {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  variant?: TabsVariant;
  className?: string;
}) {
  const baseId = useId();
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id ?? '');
  const selected = value ?? inner;
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.findIndex((item) => item.id === selected);
    let next: TabItem | undefined;
    if (event.key === 'ArrowRight') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowLeft') next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    if (next) {
      event.preventDefault();
      select(next.id);
      tabRefs.current[next.id]?.focus();
    }
  };

  const current = items.find((item) => item.id === selected);
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className={listClass(variant)} onKeyDown={onKeyDown}>
        {items.map((item) => {
          const isSelected = item.id === selected;
          return (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[item.id] = element;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={isSelected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.id)}
              className={tabClass(variant, isSelected)}
            >
              {item.label}
              {item.badge !== undefined && (
                <span className={cn('rounded-full px-1.5 text-xs', isSelected ? 'bg-role-100 text-role-700' : 'bg-slate-200 text-slate-700')}>{item.badge}</span>
              )}
            </button>
          );
        })}
      </div>
      {current && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${current.id}`}
          aria-labelledby={`${baseId}-tab-${current.id}`}
          tabIndex={0}
          className="mt-4 animate-fade-in focus-visible:outline-offset-4"
        >
          {current.content}
        </div>
      )}
    </div>
  );
}

/** Tabs that are links (each tab is a page): a nav with the current page marked (`aria-current="page"`). */
export function TabLinks({ items, label, variant = 'underline', className }: {
  items: { to: string; label: ReactNode; end?: boolean; icon?: ReactNode }[];
  label: string;
  variant?: TabsVariant;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn(listClass(variant), className)}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => tabClass(variant, isActive)}>
          {item.icon}
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
