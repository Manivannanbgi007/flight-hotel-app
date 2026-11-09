import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { ExternalLink, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { Breadcrumbs, type Crumb } from '@/components/ui/Breadcrumbs';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { usePublicSettings } from '@/features/settings/usePublicSettings';
import { cn } from '@/lib/cn';
import { HOME_PATH } from '@/lib/paths';
import { AppBackdrop } from '../AppBackdrop';
import { InLayoutContext } from '../layoutContext';
import { NavDrawer } from '../nav/NavDrawer';
import { NavTooltip } from '../nav/NavTooltip';
import { SidebarNav } from '../nav/SidebarNav';
import { UserMenu } from '../UserMenu';
import type { StaffNavSection, StaffRole } from './staffNav';

const COLLAPSED_KEY = 'fh.staff.sidebarCollapsed';

/** Sidebar widths: expanded (icons and names) and collapsed (icons). The page's left padding follows them. */
const EXPANDED_WIDTH = '17rem';
const COLLAPSED_WIDTH = '4.75rem';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
  } catch {
    // Storage blocked (private mode): the sidebar simply opens expanded next time.
  }
}

interface StaffShellProps {
  /** Decides the accent colour: admin indigo, manager teal, support violet. */
  role: StaffRole;
  /** "Admin portal" */
  title: string;
  /** Icon in the sidebar's brand tile. */
  icon: ReactNode;
  /** Where the brand tile links to (the portal's start page). */
  home: string;
  sections: StaffNavSection[];
  breadcrumbs: Crumb[];
  /** The header's search (the global search, `GlobalSearch`); it brings its own layout (a field, or a button on phones). */
  searchSlot?: ReactNode;
  /** Under the sidebar's brand row (not in the icon rail): who or what the portal is about, e.g. the open hotel. */
  identity?: ReactNode;
  /** In the header before the search (the hotel switcher). */
  headerSlot?: ReactNode;
  /** The page (default: the matching child route). */
  children?: ReactNode;
}

/**
 * The one layout of the staff portals (admin, hotel manager, support).
 *
 * - Sidebar (from `lg`): fixed on the left, white, with the portal's brand tile, grouped links with icons, the current
 *   page in the role colour, submenus, and "View website". It collapses to icons with tooltips (remembered on this
 *   device); its width animates and the page's width follows.
 * - Header: sticky, with the sidebar toggle (the drawer button on phones and small tablets, where the logo shows too),
 *   breadcrumbs, the search (`searchSlot`), live status, notifications and the account menu (name and role).
 * - Main: the page, with room at the bottom for the AI assistant's button.
 *
 * Sets `--app-header-height` (sticky table headers stop under the header) and `--sidebar-width`.
 */
export function StaffShell({ role, title, icon, home, sections, breadcrumbs, searchSlot, identity, headerSlot, children }: StaffShellProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();

  // A new page closes the drawer.
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      writeCollapsed(!value);
      return !value;
    });
  };

  const frame = {
    '--sidebar-width': collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
    '--app-header-height': '4rem',
  } as CSSProperties;

  return (
    <InLayoutContext.Provider value>
      <div className={cn(`role-${role}`, 'relative isolate min-h-dvh bg-app')} style={frame}>
        <AppBackdrop />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-lg"
        >
          Skip to content
        </a>

        <div
          id="staff-sidebar"
          className="fixed inset-y-0 left-0 z-40 hidden w-(--sidebar-width) border-r border-slate-200/80 bg-white shadow-[1px_0_0_0_rgb(15_23_42/0.02),8px_0_24px_-20px_rgb(15_23_42/0.25)] transition-[width] duration-(--duration-slow) ease-out-soft [view-transition-name:app-sidebar] lg:block"
        >
          <SidebarPanel title={title} icon={icon} home={home} sections={sections} collapsed={collapsed} identity={identity} />
        </div>

        <div className="flex min-h-dvh min-w-0 flex-col transition-[padding] duration-(--duration-slow) ease-out-soft lg:pl-(--sidebar-width)">
          <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl backdrop-saturate-150 [view-transition-name:app-header]">
            <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-expanded={drawerOpen}
                aria-label="Open navigation"
                className={cn(HEADER_ICON_BUTTON, '-ml-1 inline-flex lg:hidden')}
              >
                <Menu className="size-5" aria-hidden="true" />
              </button>
              <Link to={home} className="flex shrink-0 items-center gap-2 rounded-xl lg:hidden" aria-label={`${title} home`}>
                <BrandTile icon={icon} small />
              </Link>
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
                aria-controls="staff-sidebar"
                className={cn(HEADER_ICON_BUTTON, '-ml-2 hidden lg:inline-flex')}
              >
                {collapsed ? <PanelLeftOpen className="size-5" aria-hidden="true" /> : <PanelLeftClose className="size-5" aria-hidden="true" />}
                <span className="sr-only">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
              </button>
              <span aria-hidden="true" className="hidden h-6 w-px bg-slate-200 lg:block" />
              <Breadcrumbs items={breadcrumbs} className="min-w-0 flex-1" />
              {headerSlot}
              {searchSlot}
              <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2.5">
                {/* Very wide screens only: most pages show their own live badge. Wrapped: `cn` does not merge classes, so
                    `hidden` on LiveIndicator would lose to its own inline-flex. */}
                <span className="hidden 2xl:inline-flex">
                  <LiveIndicator />
                </span>
                <NotificationBell />
                <span aria-hidden="true" className="hidden h-6 w-px bg-slate-200 sm:block" />
                <UserMenu />
              </div>
            </div>
          </header>

          {/* Bottom padding: the end of every page (pagination, the last buttons) scrolls clear of the AI assistant's
              floating button (56 px, 24 px from the bottom).
              Width: fluid, so tables, filters and dashboards use the whole space beside the sidebar. Capped at 1920 px
              so ultra-wide monitors do not stretch rows past reading distance. */}
          <main id="main" className="flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pt-8">
            <div className="mx-auto w-full max-w-[120rem]">{children ?? <Outlet />}</div>
          </main>
        </div>

        {drawerOpen && (
          <NavDrawer label={`${title} navigation`} onClose={() => setDrawerOpen(false)} returnFocus={menuButtonRef} className="lg:hidden">
            <SidebarPanel title={title} icon={icon} home={home} sections={sections} collapsed={false} identity={identity} />
          </NavDrawer>
        )}
      </div>
    </InLayoutContext.Provider>
  );
}

/** Without `display`: each button says where it shows (`cn` does not merge `hidden` and `inline-flex`). */
const HEADER_ICON_BUTTON =
  'size-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition-colors duration-(--duration-fast) hover:bg-slate-100 hover:text-slate-900';

/** The portal's tile: its icon on the role gradient. */
function BrandTile({ icon, small = false }: { icon: ReactNode; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--role-500),var(--role-700))] text-white shadow-md shadow-role-900/20 ring-1 ring-inset ring-white/20',
        small ? 'size-9 [&>svg]:size-[1.1rem]' : 'size-10',
      )}
    >
      {icon}
    </span>
  );
}

function SidebarPanel({ title, icon, home, sections, collapsed, identity }: {
  title: string;
  icon: ReactNode;
  home: string;
  sections: StaffNavSection[];
  collapsed: boolean;
  identity?: ReactNode;
}) {
  const { settings } = usePublicSettings();
  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-16 shrink-0 items-center border-b border-slate-100', collapsed ? 'justify-center px-2' : 'px-4')}>
        <NavTooltip label={title} enabled={collapsed}>
          <Link to={home} className="flex min-w-0 items-center gap-3 rounded-xl">
            <BrandTile icon={icon} />
            <span className={cn('min-w-0', collapsed && 'sr-only')}>
              <span className="block truncate text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-slate-500">{settings.siteName}</span>
              <span className="block truncate text-sm font-bold text-slate-900">{title}</span>
            </span>
          </Link>
        </NavTooltip>
      </div>

      {identity && !collapsed && <div className="shrink-0 border-b border-slate-100 p-3">{identity}</div>}

      <div
        className={cn(
          'flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-5 [@media(max-height:760px)]:py-3',
          // The icon rail is too narrow for a scrollbar (it would sit on the icons): it still scrolls, unseen.
          collapsed ? '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : '[scrollbar-width:thin]',
        )}
      >
        <SidebarNav sections={sections} collapsed={collapsed} />
      </div>

      <div className={cn('shrink-0 border-t border-slate-100 py-3', collapsed ? 'px-2.5' : 'px-3')}>
        <NavTooltip label="View website" enabled={collapsed}>
          <Link
            to={HOME_PATH}
            className={cn(
              'group flex items-center gap-3 rounded-xl py-2 text-sm font-medium text-slate-600 transition-colors duration-(--duration-fast) hover:bg-slate-100 hover:text-slate-900',
              collapsed ? 'mx-auto size-11 justify-center' : 'px-3',
            )}
          >
            <ExternalLink className="size-[1.125rem] shrink-0 text-slate-400 group-hover:text-slate-600" aria-hidden="true" />
            <span className={cn('truncate', collapsed && 'sr-only')}>View website</span>
          </Link>
        </NavTooltip>
      </div>
    </div>
  );
}
