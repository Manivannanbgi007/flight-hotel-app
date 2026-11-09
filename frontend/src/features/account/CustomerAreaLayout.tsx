import { useRef, useState, type CSSProperties } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { AppBackdrop } from '@/components/layout/AppBackdrop';
import { InContentFrameContext } from '@/components/layout/layoutContext';
import { NavDrawer } from '@/components/layout/nav/NavDrawer';
import { NavTooltip } from '@/components/layout/nav/NavTooltip';
import { SidebarNav } from '@/components/layout/nav/SidebarNav';
import type { AuthUser } from '@/lib/auth/types';
import { primaryRoleLabel } from '@/lib/auth/roleLabels';
import { cn } from '@/lib/cn';
import { Avatar } from './Avatar';
import { customerNav } from './customerNav';

const COLLAPSED_KEY = 'fh.customer.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The signed-in customer's area (dashboard, My Trips, a trip, every "My account" page) inside the public header and
 * footer: a sticky sidebar card on the left (who is signed in, the grouped pages, collapse to icons with tooltips,
 * remembered on this device) and the page beside it. Phones and tablets: a "My account menu" button opens the same
 * links in a drawer. Pages keep using PageContainer; inside this frame it only holds their content.
 *
 * Above the routes' own guards: until someone is signed in it renders just the page (the guard's redirect or loader).
 */
export function CustomerAreaLayout() {
  const { status, user } = useAuth();
  if (status !== 'authenticated' || !user) {
    return <Outlet />;
  }
  return <CustomerArea user={user} />;
}

function CustomerArea({ user }: { user: AuthUser }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  const sections = customerNav(user);

  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
      } catch {
        // Not remembered.
      }
      return !value;
    });
  };

  return (
    <InContentFrameContext.Provider value>
      <div className="relative isolate">
        <AppBackdrop within />
        <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            className="mb-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-xs transition-colors hover:bg-slate-50 lg:hidden"
          >
            <Menu className="size-4 text-brand-600" aria-hidden="true" />
            My account menu
          </button>

          <div
            className="lg:grid lg:grid-cols-[var(--area-sidebar)_minmax(0,1fr)] lg:items-start lg:gap-8 lg:transition-[grid-template-columns] lg:duration-(--duration-slow) lg:ease-out-soft"
            style={{ '--area-sidebar': collapsed ? '4.75rem' : '16.5rem' } as CSSProperties}
          >
            <aside id="account-sidebar" aria-label="My account pages" className="sticky top-22 hidden lg:block">
              <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
                <UserCard user={user} collapsed={collapsed} />
                <div
                  className={cn(
                    'max-h-[calc(100dvh-15rem)] overflow-y-auto overflow-x-hidden overscroll-contain py-4 [@media(max-height:760px)]:py-3',
                    // The icon rail is too narrow for a scrollbar (it would sit on the icons): it still scrolls, unseen.
                    collapsed ? '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : '[scrollbar-width:thin]',
                  )}
                >
                  <SidebarNav sections={sections} collapsed={collapsed} />
                </div>
                <div className={cn('border-t border-slate-100 py-2', collapsed ? 'px-2.5' : 'px-3')}>
                  <NavTooltip label="Expand sidebar" enabled={collapsed}>
                    <button
                      type="button"
                      onClick={toggleCollapsed}
                      aria-expanded={!collapsed}
                      aria-controls="account-sidebar"
                      className={cn(
                        'group flex items-center gap-3 rounded-xl py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900',
                        collapsed ? 'mx-auto size-11 justify-center [@media(max-height:760px)]:size-10' : 'w-full px-3',
                      )}
                    >
                      {collapsed ? (
                        <PanelLeftOpen className="size-[1.125rem] shrink-0 text-slate-400 group-hover:text-slate-600" aria-hidden="true" />
                      ) : (
                        <PanelLeftClose className="size-[1.125rem] shrink-0 text-slate-400 group-hover:text-slate-600" aria-hidden="true" />
                      )}
                      <span className={cn(collapsed && 'sr-only')}>{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
                    </button>
                  </NavTooltip>
                </div>
              </div>
            </aside>
            <div className="min-w-0">
              <Outlet />
            </div>
          </div>
        </div>
      </div>

      {drawerOpen && (
        <NavDrawer label="My account navigation" onClose={() => setDrawerOpen(false)} returnFocus={menuButtonRef} className="lg:hidden">
          <UserCard user={user} collapsed={false} className="pr-14" />
          <div className="flex-1 overflow-y-auto py-4">
            <SidebarNav sections={sections} />
          </div>
        </NavDrawer>
      )}
    </InContentFrameContext.Provider>
  );
}

/** Who is signed in: avatar, name and role (the avatar alone when collapsed). */
function UserCard({ user, collapsed, className }: { user: AuthUser; collapsed: boolean; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-slate-100 bg-slate-50/70',
        collapsed ? 'justify-center px-2 py-3' : 'py-3.5 pl-4',
        !collapsed && !className && 'pr-4',
        className,
      )}
    >
      <Avatar user={user} />
      <div className={cn('min-w-0', collapsed && 'sr-only')}>
        <p className="truncate text-sm font-bold text-slate-900">{user.firstName} {user.lastName}</p>
        <p className="truncate text-xs font-medium text-slate-500">{primaryRoleLabel(user.roles)}</p>
      </div>
    </div>
  );
}
