/**
 * The staff portals' navigation types: the shared sidebar model (`../nav/navModel`) under their earlier names, so the
 * portals' layouts and tests keep working.
 */
export type {
  NavGroup as StaffNavGroup,
  NavItem as StaffNavItem,
  NavSection as StaffNavSection,
} from '../nav/navModel';
export { crumbsFromNav, isItemActive } from '../nav/navModel';

export type StaffRole = 'admin' | 'manager' | 'support';
