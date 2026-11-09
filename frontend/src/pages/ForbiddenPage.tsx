import { Link, useLocation } from 'react-router';
import { LayoutDashboard, LogIn } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { AccessDeniedIllustration } from '@/components/illustrations';
import { MinimalFrame } from '@/components/layout/MinimalFrame';
import { buttonClass } from '@/components/ui/buttonStyles';
import { areaOfPath, portalOfArea, signInPath, type Area } from '@/lib/auth/portals';
import { defaultLanding } from '@/lib/auth/redirects';
import { HOME_PATH } from '@/lib/paths';

/**
 * Logged in, but this area is for another role: says who is logged in and whom the area is for, and offers the
 * user's own dashboard and the right sign-in page (which comes back here after login).
 */
export function ForbiddenPage({ area }: { area?: Area }) {
  const { user } = useAuth();
  const location = useLocation();
  const portal = portalOfArea(area ?? areaOfPath(location.pathname));
  const here = location.pathname + location.search;

  return (
    <MinimalFrame>
      <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center sm:py-20">
        <AccessDeniedIllustration className="w-56 animate-fade-in sm:w-64" />
        <p className="mt-6 inline-flex items-center rounded-full bg-warning-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-warning-700 ring-1 ring-warning-200">
          Access denied
        </p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">You don't have access to this page</h1>
        <p className="mt-3 leading-relaxed text-slate-600">
          This area is for {portal.audience}.
          {user && <> You are logged in as {user.firstName} {user.lastName}, whose account cannot open it.</>}
          {' '}If you think you should have access, contact your administrator.
        </p>
        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          {user && (
            <Link to={defaultLanding(user)} className={buttonClass({ size: 'lg' })}>
              <LayoutDashboard className="size-5" aria-hidden="true" />
              Go to my dashboard
            </Link>
          )}
          <Link to={signInPath(portal.portal, { redirect: here })} className={buttonClass({ variant: 'secondary', size: 'lg' })}>
            <LogIn className="size-5" aria-hidden="true" />
            {portal.signInLabel}
          </Link>
        </div>
        <Link to={HOME_PATH} className="mt-6 text-sm font-semibold text-brand-700 hover:underline">Go to home</Link>
      </section>
    </MinimalFrame>
  );
}
