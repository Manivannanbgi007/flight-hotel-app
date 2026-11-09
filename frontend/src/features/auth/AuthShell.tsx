import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';

import { Logo } from '@/components/layout/Logo';
import { usePublicSettings } from '@/features/settings/usePublicSettings';
import { cn } from '@/lib/cn';
import { HOME_PATH } from '@/lib/paths';
import type { AuthStory } from './authStories';

/**
 * The one layout of every sign-in and account screen (the four sign-in pages, register, forgot and reset password,
 * verify e-mail): full screen, without the site header and footer, so nothing competes with the form.
 *
 * - The form column comes first in the reading order (it holds the h1). From laptop width it sits on the right, and
 *   the story panel fills the left in the portal's colour (`roleClass`: role-admin, role-manager, role-support; none =
 *   brand). The panel stays in view while a long form scrolls.
 * - On phones and tablets the panel is left out (it only repeats what the portal is for); a soft wash of the portal
 *   colour at the top of the form keeps the page from looking bare.
 * - `wide`: a wider form column for two-column forms (register).
 */
export function AuthShell({ roleClass = '', story, wide = false, children }: {
  roleClass?: string;
  story: AuthStory;
  wide?: boolean;
  children: ReactNode;
}) {
  const { settings } = usePublicSettings();
  const { Illustration } = story;
  return (
    <div className={cn(roleClass, 'min-h-dvh bg-white')}>
      <a
        href="#auth-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-lg"
      >
        Skip to the form
      </a>
      <main id="main" className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* The form column (first in reading order; on the right from laptop width). */}
        <div className="relative isolate flex min-w-0 flex-col px-5 py-5 sm:px-10 lg:order-2 lg:px-14 xl:px-20">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-gradient-to-b from-role-50 via-role-50/40 to-transparent lg:hidden" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-grid-light lg:hidden" />

          <div className="flex items-center justify-between gap-3">
            <Link to={HOME_PATH} className="rounded-xl">
              <Logo name={settings.siteName} />
            </Link>
            <Link
              to={HOME_PATH}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to home
            </Link>
          </div>

          <div className="flex flex-1 items-center justify-center py-10 lg:py-14">
            <div id="auth-content" className={cn('w-full animate-fade-up', wide ? 'max-w-lg' : 'max-w-[26.5rem]')}>
              {children}
            </div>
          </div>

          <p className="text-center text-xs text-slate-500">
            © {new Date().getFullYear()} {settings.siteName}
            <span aria-hidden="true"> · </span>
            <Link to="/help" className="font-medium text-slate-600 hover:text-slate-900 hover:underline">
              Help & Support
            </Link>
          </p>
        </div>

        {/* The story panel (left from laptop width; left out on smaller screens). */}
        <section
          aria-labelledby="auth-story"
          className="relative isolate hidden min-w-0 overflow-hidden bg-[linear-gradient(160deg,var(--role-950)_0%,var(--role-800)_52%,var(--role-600)_100%)] text-white lg:sticky lg:top-0 lg:order-1 lg:flex lg:h-dvh lg:self-start"
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-grid-faint" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 -z-10 size-[28rem] rounded-full bg-role-400/30 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-24 -z-10 size-[26rem] rounded-full bg-accent-400/20 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-1/4 right-0 -z-10 size-72 rounded-full bg-violet-400/15 blur-3xl" />

          <div className="mx-auto flex w-full max-w-xl flex-col justify-center px-12 py-12 xl:px-16">
            <div aria-hidden="true" className="relative">
              <div className="absolute inset-10 -z-10 rounded-full bg-white/10 blur-3xl" />
              <Illustration className="mx-auto w-full max-w-md animate-fade-in" />
            </div>
            <h2 id="auth-story" className="mt-8 text-3xl font-bold tracking-tight text-balance xl:text-[2.125rem] xl:leading-tight">
              {story.title}
            </h2>
            <p className="mt-3 max-w-lg text-base leading-relaxed text-white/90">{story.text}</p>
            <ul className="mt-8 grid gap-3 stagger">
              {story.points.map(({ icon: PointIcon, text }) => (
                <li key={text} className="flex items-center gap-3.5">
                  <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/12 text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm">
                    <PointIcon className="size-5" />
                  </span>
                  <span className="text-[0.9375rem] font-medium text-white">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

/**
 * The top of an auth screen: an optional portal badge, icon tile or illustration (state screens: "Check your inbox"),
 * the page's h1 and a subtitle. `center` for state screens.
 */
export function AuthHeader({ badge, icon, illustration, title, subtitle, center = false }: {
  badge?: ReactNode;
  icon?: ReactNode;
  illustration?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cn(center && 'text-center')}>
      {illustration && (
        <div aria-hidden="true" className="mb-4 flex justify-center">
          <div className="animate-float">{illustration}</div>
        </div>
      )}
      {icon && !illustration && (
        <span
          aria-hidden="true"
          className={cn(
            'mb-6 flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--role-500),var(--role-700))] text-white shadow-glow ring-1 ring-inset ring-white/25',
            center && 'mx-auto',
          )}
        >
          {icon}
        </span>
      )}
      {badge && (
        <p className="inline-flex rounded-full bg-role-50 px-3 py-1 text-xs font-semibold text-role-700 ring-1 ring-inset ring-role-100">
          {/* The inner span keeps icon-colors.css from taking the badge for an icon tile (an icon as the only element
              child of a bg-role-50 box), which would recolour the text below 4.5:1. */}
          <span className="inline-flex items-center gap-1.5">{badge}</span>
        </p>
      )}
      <h1 className={cn('text-[1.75rem] font-bold leading-tight tracking-tight text-slate-900 sm:text-[2rem]', badge && 'mt-4')}>
        {title}
      </h1>
      {subtitle && <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-slate-600">{subtitle}</p>}
    </div>
  );
}

/** "Back to log in" and similar quiet links under an auth form. */
export function AuthFootnote({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mt-8 text-center text-sm text-slate-600', className)}>{children}</div>;
}
