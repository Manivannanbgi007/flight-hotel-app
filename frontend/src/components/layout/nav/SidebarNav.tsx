import { useId, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/cn';
import { isTreeActive, type NavItem, type NavSection } from './navModel';
import { NavTooltip } from './NavTooltip';

interface SidebarNavProps {
  sections: NavSection[];
  /** Icons only: names in tooltips (and for screen readers), groups as thin lines, submenus open from their link. */
  collapsed?: boolean;
}

/**
 * The links of a sidebar (staff portals, the customer's area): one `<nav>` per section, groups with small caps titles,
 * an icon for every link, the current page in the portal's accent with a bar on its left, and submenus that open by
 * themselves on one of their pages. Navigation cross-fades the page (View Transitions, where supported).
 */
export function SidebarNav({ sections, collapsed = false }: SidebarNavProps) {
  const { pathname } = useLocation();
  return (
    <div className={cn('flex flex-col gap-5 [@media(max-height:760px)]:gap-3', collapsed ? 'px-2.5' : 'px-3')}>
      {sections.map((section) => (
        <nav key={section.label} aria-label={section.label} className="flex flex-col gap-5 [@media(max-height:760px)]:gap-3">
          {section.groups.map((group, index) => (
            <div key={group.title ?? index} className="flex flex-col gap-1">
              {group.title &&
                (collapsed ? (
                  <span aria-hidden="true" className="mx-auto mb-1 h-px w-6 bg-slate-200" />
                ) : (
                  <p className="mb-0.5 truncate px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    {group.title}
                  </p>
                ))}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    {item.children?.length ? (
                      <SubmenuEntry item={item} collapsed={collapsed} pathname={pathname} />
                    ) : (
                      <LinkEntry item={item} collapsed={collapsed} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      ))}
    </div>
  );
}

/**
 * A sidebar row; `active` = the current page (or, for a submenu's link when collapsed, one of its pages). Submenu
 * links (`nested`) are a little tighter and have no bar (the submenu's line marks them).
 */
const rowClass = (active: boolean, collapsed: boolean, nested = false) =>
  cn(
    'group relative flex items-center rounded-xl text-sm transition-[background-color,color,box-shadow] duration-(--duration-fast) ease-out-soft',
    collapsed ? 'mx-auto size-11 justify-center [@media(max-height:760px)]:size-10' : cn('w-full gap-3 px-3', nested ? 'py-1.5' : 'py-2'),
    active
      ? cn(
          'bg-role-50 font-semibold text-role-700 shadow-[inset_0_0_0_1px_var(--role-100)]',
          !nested && 'before:absolute before:top-1/2 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-role-600',
          !nested && (collapsed ? 'before:-left-2.5' : 'before:-left-3'),
        )
      : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  );

const iconClass = (active: boolean) =>
  cn('size-[1.125rem] shrink-0 transition-colors duration-(--duration-fast)', active ? 'text-role-600' : 'text-slate-400 group-hover:text-slate-600');

function LinkEntry({ item, collapsed, nested = false }: { item: NavItem; collapsed: boolean; nested?: boolean }) {
  const Icon = item.icon;
  return (
    <NavTooltip label={item.label} enabled={collapsed}>
      <NavLink
        to={item.to}
        end={item.end}
        viewTransition
        className={({ isActive }) => rowClass(isActive, collapsed, nested && !collapsed)}
      >
        {({ isActive }) => (
          <>
            {nested ? (
              <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', isActive ? 'bg-role-600' : 'bg-slate-300 group-hover:bg-slate-400')} />
            ) : (
              <Icon className={iconClass(isActive)} aria-hidden="true" />
            )}
            <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
          </>
        )}
      </NavLink>
    </NavTooltip>
  );
}

/** A link with a submenu. Expanded: a button that opens it (open by itself on one of its pages). Collapsed: a link. */
function SubmenuEntry({ item, collapsed, pathname }: { item: NavItem; collapsed: boolean; pathname: string }) {
  const listId = useId();
  const active = isTreeActive(item, pathname);
  const [open, setOpen] = useState(active);
  // Arriving on one of its pages opens the submenu (the person can still close it).
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setOpen(true);
  }
  const Icon = item.icon;

  if (collapsed) {
    return (
      <NavTooltip label={item.label} enabled>
        <NavLink to={item.to} viewTransition className={() => rowClass(active, true)}>
          <Icon className={iconClass(active)} aria-hidden="true" />
          <span className="sr-only">{item.label}</span>
        </NavLink>
      </NavTooltip>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className={cn(rowClass(false, false), active && 'font-semibold text-slate-900')}
      >
        <Icon className={iconClass(active)} aria-hidden="true" />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-slate-400 transition-transform duration-(--duration-base) ease-out-soft', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul id={listId} className="ml-[1.3rem] mt-0.5 flex flex-col gap-0.5 border-l border-slate-200 pl-2.5 animate-slide-down">
          {item.children!.map((child) => (
            <li key={child.to}>
              <LinkEntry item={child} collapsed={false} nested />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
