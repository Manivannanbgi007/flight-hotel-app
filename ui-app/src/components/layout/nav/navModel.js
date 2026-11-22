/** Is `item` the page at `pathname` (or one of its sub-pages)? */
export function isItemActive(item, pathname) {
  if (item.end) return pathname === item.to || pathname === `${item.to}/`;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** The item or one of its submenu items is the page at `pathname` (its submenu opens). */
export function isTreeActive(item, pathname) {
  return isItemActive(item, pathname) || (item.children ?? []).some((child) => isTreeActive(child, pathname));
}

/** Every link of the sections, submenu items included. */
export function allItems(sections) {
  const flatten = (items) => items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
  return sections.flatMap((section) => section.groups.flatMap((group) => flatten(group.items)));
}

/**
 * Breadcrumbs from the sidebar: root › the deepest matching link › "Details" for pages below it.
 * `/admin/bookings/42` → Admin portal › Bookings › Details.
 */
export function crumbsFromNav(pathname, root, sections) {
  const match = allItems(sections)
    .filter((item) => isItemActive(item, pathname))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const crumbs = [{ label: root.label, to: root.to }];
  if (!match) {
    return pathname.replace(/\/$/, '') === root.to ? [{ label: root.label }] : [...crumbs, { label: 'Page' }];
  }
  const deeper = pathname.replace(/\/$/, '') !== match.to;
  crumbs.push(deeper ? { label: match.label, to: match.to } : { label: match.label });
  if (deeper) crumbs.push({ label: 'Details' });
  return crumbs;
}
