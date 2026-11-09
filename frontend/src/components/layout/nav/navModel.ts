import type { LucideIcon } from 'lucide-react';

import type { Crumb } from '@/components/ui/Breadcrumbs';

/** A link of a sidebar. With `children` it is a group that opens (a submenu); its own `to` is where it leads when the sidebar is collapsed. */
export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Active only on exactly this path (a portal's start page, a list above its sub-pages). */
  end?: boolean;
  /** A submenu (one level). */
  children?: NavItem[];
}

export interface NavGroup {
  /** Small caps title above the group (a thin line when the sidebar is collapsed). */
  title?: string;
  items: NavItem[];
}

/** One <nav> landmark of a sidebar; `label` is its accessible name ("Admin", "Hotel sections", "My account"). */
export interface NavSection {
  label: string;
  groups: NavGroup[];
}

/** Is `item` the page at `pathname` (or one of its sub-pages)? */
export function isItemActive(item: Pick<NavItem, 'to' | 'end'>, pathname: string): boolean {
  if (item.end) return pathname === item.to || pathname === `${item.to}/`;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** The item or one of its submenu items is the page at `pathname` (its submenu opens). */
export function isTreeActive(item: NavItem, pathname: string): boolean {
  return isItemActive(item, pathname) || (item.children ?? []).some((child) => isTreeActive(child, pathname));
}

/** Every link of the sections, submenu items included. */
export function allItems(sections: NavSection[]): NavItem[] {
  const flatten = (items: NavItem[]): NavItem[] => items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
  return sections.flatMap((section) => section.groups.flatMap((group) => flatten(group.items)));
}

/**
 * Breadcrumbs from the sidebar: root › the deepest matching link › "Details" for pages below it.
 * `/admin/bookings/42` → Admin portal › Bookings › Details.
 */
export function crumbsFromNav(pathname: string, root: Crumb & { to: string }, sections: NavSection[]): Crumb[] {
  const match = allItems(sections)
    .filter((item) => isItemActive(item, pathname))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const crumbs: Crumb[] = [{ label: root.label, to: root.to }];
  if (!match) {
    return pathname.replace(/\/$/, '') === root.to ? [{ label: root.label }] : [...crumbs, { label: 'Page' }];
  }
  const deeper = pathname.replace(/\/$/, '') !== match.to;
  crumbs.push(deeper ? { label: match.label, to: match.to } : { label: match.label });
  if (deeper) crumbs.push({ label: 'Details' });
  return crumbs;
}
