import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { usePublicSettings } from '@/features/settings/usePublicSettings';
import { HOME_PATH } from '@/lib/paths';
import { InLayoutContext, useInLayout } from './layoutContext';
import { Logo } from './Logo';

/**
 * Gives a page that can also be shown on its own (access denied outside the public layout, a route error that
 * replaced the layout) a slim header with the logo and a <main> landmark. Inside a layout it adds nothing.
 */
export function MinimalFrame({ children }: { children: ReactNode }) {
  const inLayout = useInLayout();
  const { settings } = usePublicSettings();
  if (inLayout) {
    return <>{children}</>;
  }
  return (
    <InLayoutContext.Provider value>
      <div className="flex min-h-dvh flex-col bg-gradient-sky">
        <header className="mx-auto flex h-16 w-full max-w-7xl items-center px-4 sm:px-6">
          <Link to={HOME_PATH} className="rounded-xl">
            <Logo name={settings.siteName} />
          </Link>
        </header>
        <main id="main" className="flex flex-1 items-center justify-center">
          {children}
        </main>
      </div>
    </InLayoutContext.Provider>
  );
}
