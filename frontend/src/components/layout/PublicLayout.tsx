import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { BedDouble, BadgePercent, LifeBuoy, Luggage, Menu, Plane, X, type LucideIcon } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { GlobalSearch } from '@/features/search/GlobalSearch';
import { usePublicSettings } from '@/features/settings/usePublicSettings';
import { PORTALS } from '@/lib/auth/portals';
import { cn } from '@/lib/cn';
import { HOME_PATH } from '@/lib/paths';
import { InLayoutContext } from './layoutContext';
import { Logo } from './Logo';
import { SiteFooter } from './SiteFooter';
import { UserMenu } from './UserMenu';

const navItems: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/flights', label: 'Flights', icon: Plane },
  { to: '/hotels', label: 'Hotels', icon: BedDouble },
  { to: '/my-trips', label: 'My Trips', icon: Luggage },
  { to: '/offers', label: 'Offers', icon: BadgePercent },
  { to: '/help', label: 'Help & Support', icon: LifeBuoy },
];

/** True once the page is scrolled a little: the glass header then gets its shadow. */
function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

/**
 * Public site and customer pages: glassy sticky header (main navigation, the global search, live status, bell, account
 * menu), footer. The global search is there for everyone, signed in or not (a customer's trips are among its results);
 * on phones it sits at the top of the mobile menu.
 */
export function PublicLayout() {
  const { settings } = usePublicSettings();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolled = useScrolled();
  const { pathname } = useLocation();

  // A new page closes the mobile menu (also when it was left with the browser's back button).
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <InLayoutContext.Provider value>
      {/* --app-header-height: sticky table headers stop under the 64 px header. */}
      <div className="flex min-h-dvh flex-col [--app-header-height:4rem]">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-lg"
        >
          Skip to content
        </a>
        <header
          className={cn(
            'glass sticky top-0 z-40 border-b transition-[box-shadow,border-color] duration-(--duration-base) [view-transition-name:app-header]',
            scrolled || menuOpen ? 'border-slate-200/80 shadow-md' : 'border-transparent',
          )}
        >
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link to={HOME_PATH} className="shrink-0 rounded-xl">
              <Logo name={settings.siteName} />
            </Link>

            <nav aria-label="Main" className="hidden items-center gap-1 rounded-full bg-white/70 p-1 shadow-xs ring-1 ring-slate-200/70 md:flex">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  viewTransition
                  className={({ isActive }) =>
                    cn(
                      // Compact between md and lg, where the header also holds the search button.
                      'whitespace-nowrap rounded-full px-2 py-1.5 text-sm font-semibold transition-colors duration-(--duration-fast) lg:px-3.5',
                      isActive ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100' : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-2 sm:gap-3">
              <GlobalSearch variant="public" />
              {/* Not between md and xl: the main navigation and the search fill the header there. */}
              <span className="contents md:hidden xl:contents">
                <LiveIndicator className="hidden sm:inline-flex" />
              </span>
              <NotificationBell />
              <UserMenu />
              <button
                type="button"
                className="rounded-xl p-2 text-slate-700 transition-colors hover:bg-slate-100 md:hidden"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                aria-controls="mobile-menu"
                onClick={() => setMenuOpen((open) => !open)}
              >
                {menuOpen ? <X className="size-6" aria-hidden="true" /> : <Menu className="size-6" aria-hidden="true" />}
              </button>
            </div>
          </div>

          {menuOpen && (
            <nav id="mobile-menu" aria-label="Main mobile" className="border-t border-slate-200/80 bg-white px-4 pb-4 pt-3 animate-slide-down md:hidden">
              <GlobalSearch variant="inline" shortcut={false} className="mb-2" />
              <ul className="flex flex-col gap-1">
                {navItems.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-xl px-3 py-3 text-base font-semibold',
                          isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-800 hover:bg-slate-100',
                        )
                      }
                    >
                      <Icon className="size-5 text-brand-600" aria-hidden="true" />
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
              {!user && (
                <Link
                  to={PORTALS.CUSTOMER.signInPath}
                  onClick={() => setMenuOpen(false)}
                  className="mt-3 flex items-center justify-center rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-glow"
                >
                  Login / Register
                </Link>
              )}
            </nav>
          )}
        </header>

        <main id="main" className="flex-1">
          <Outlet />
        </main>

        <SiteFooter />
      </div>
    </InLayoutContext.Provider>
  );
}
