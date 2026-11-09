import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, BedDouble, CircleCheck, LayoutDashboard, Luggage, Plane, Sparkles, UserPlus } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { usePublicSettings } from '@/features/settings/usePublicSettings';
import { PORTALS } from '@/lib/auth/portals';
import { hasAnyRole } from '@/lib/auth/types';
import { cn } from '@/lib/cn';
import { greetingFor } from './greeting';

const glassLink =
  'inline-flex h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/30 backdrop-blur-sm transition-colors duration-(--duration-fast) hover:bg-white/20';
const solidLink =
  'group inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-800 shadow-lg transition-colors duration-(--duration-fast) hover:bg-brand-50';

/**
 * The top of the home page: a drifting gradient band with a greeting (signed in) or what the site is (visitors), the
 * page title, two links that say where to go next, and a route map where flight paths draw themselves and planes fly
 * them (decorative, from lg). `children` (the search card) overlaps the band's lower edge.
 */
export function HomeHero({ children }: { children: ReactNode }) {
  const { settings, isLoading } = usePublicSettings();
  const { user } = useAuth();
  const customer = hasAnyRole(user, ['CUSTOMER']);

  return (
    <>
      <section
        aria-labelledby="home-title"
        className={cn(
          'relative isolate overflow-hidden text-white',
          'bg-[linear-gradient(125deg,var(--role-950),var(--role-800)_42%,var(--role-600)_78%,var(--role-800))] bg-[length:220%_220%] animate-gradient-pan',
        )}
      >
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-grid-faint" />
        {/* Glows as gradients inside the band: no element reaches out of it (under the sticky header axe would count it). */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(34rem_22rem_at_85%_20%,color-mix(in_srgb,var(--color-violet-500)_30%,transparent),transparent),radial-gradient(30rem_20rem_at_10%_0%,color-mix(in_srgb,var(--role-400)_35%,transparent),transparent),radial-gradient(26rem_16rem_at_60%_110%,color-mix(in_srgb,var(--color-accent-400)_22%,transparent),transparent)]"
        />

        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-32 pt-10 sm:px-6 sm:pb-36 sm:pt-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:pb-40 lg:pt-16">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold ring-1 ring-inset ring-white/25 backdrop-blur-sm animate-fade-up">
              <Sparkles className="size-4 text-accent-200" aria-hidden="true" />
              {user ? `${greetingFor(new Date().getHours())}, ${user.firstName}` : 'Flights and hotels in one place'}
            </p>
            <h1 id="home-title" className="mt-5 text-4xl font-extrabold tracking-tight text-balance animate-fade-up [animation-delay:80ms] sm:text-5xl lg:text-6xl">
              {isLoading ? (
                <span aria-hidden="true" data-skeleton="" className="skeleton inline-block h-12 w-72 max-w-full rounded-lg align-middle" />
              ) : (
                <>
                  Travel more with{' '}
                  <span className="bg-gradient-to-r from-accent-200 via-white to-sky-200 bg-clip-text text-transparent">{settings.siteName}</span>
                </>
              )}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-brand-50 animate-fade-up [animation-delay:160ms] sm:text-lg">
              Search and book domestic and international flights and hotels, pay securely, and follow every booking live.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3 animate-fade-up [animation-delay:240ms]">
              {customer ? (
                <>
                  <Link to="/my-trips" className={solidLink}>
                    <Luggage className="size-4" aria-hidden="true" /> My trips
                    <ArrowRight className="size-4 transition-transform duration-(--duration-base) group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>
                  <Link to={PORTALS.CUSTOMER.home} className={glassLink}>
                    <LayoutDashboard className="size-4" aria-hidden="true" /> My dashboard
                  </Link>
                </>
              ) : !user ? (
                <>
                  <Link to="/register" className={solidLink}>
                    <UserPlus className="size-4" aria-hidden="true" /> Create a free account
                    <ArrowRight className="size-4 transition-transform duration-(--duration-base) group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>
                  <Link to={PORTALS.CUSTOMER.signInPath} className={glassLink}>Log in</Link>
                </>
              ) : null}
            </div>
          </div>
          <RouteMap />
        </div>
      </section>
      <div className="relative z-10 mx-auto -mt-24 max-w-7xl px-4 sm:-mt-28 sm:px-6">{children}</div>
    </>
  );
}

interface City {
  code: string;
  x: number;
  y: number;
  /** Where the code sits next to its dot. */
  label: 'left' | 'right' | 'below';
}

const CITIES: City[] = [
  { code: 'DEL', x: 252, y: 96, label: 'right' },
  { code: 'DXB', x: 92, y: 150, label: 'below' },
  { code: 'BOM', x: 182, y: 196, label: 'left' },
  { code: 'GOI', x: 204, y: 256, label: 'left' },
  { code: 'BLR', x: 266, y: 282, label: 'right' },
  { code: 'SIN', x: 392, y: 240, label: 'below' },
];

/** Flight paths in the scene's own pixels (the planes follow them with `offset-path`). */
const PATHS = [
  'M 252 96 Q 190 120 182 196', // DEL → BOM
  'M 182 196 Q 128 132 92 150', // BOM → DXB
  'M 252 96 Q 360 112 392 240', // DEL → SIN
  'M 182 196 Q 250 230 266 282', // BOM → BLR
];

/** The planes: which path, how long one flight takes, where it starts in the loop and where it rests (reduced motion). */
const PLANES = [
  { path: 2, duration: '8s', delay: '-1s', rest: '55%' },
  { path: 0, duration: '6s', delay: '-3.5s', rest: '45%' },
];

/**
 * Decorative (lg and up): a globe with city dots, flight paths that draw themselves one after another, two planes that
 * keep flying them, and three floating cards (a boarding pass, a confirmed stay, live updates). No figures or claims.
 */
function RouteMap() {
  const maskPrefix = `home-route-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <div aria-hidden="true" className="relative hidden justify-self-center animate-fade-in lg:block">
      <div className="relative h-[360px] w-[460px] rounded-3xl bg-white/[0.07] ring-1 ring-inset ring-white/15 backdrop-blur-sm">
        <svg viewBox="0 0 460 360" width="460" height="360" fill="none" className="absolute inset-0">
          <defs>
            {PATHS.map((d, index) => (
              <mask key={d} id={`${maskPrefix}-${index}`} maskUnits="userSpaceOnUse" x="0" y="0" width="460" height="360">
                <path d={d} stroke="#fff" strokeWidth="8" strokeLinecap="round" pathLength={1}
                  className="animate-draw-path [stroke-dasharray:1]" style={{ animationDelay: `${400 + index * 350}ms` }} />
              </mask>
            ))}
          </defs>
          {/* The globe: an outline with two latitudes and two meridians. */}
          <g stroke="#fff" strokeOpacity="0.14">
            <circle cx="236" cy="184" r="150" fill="#fff" fillOpacity="0.03" />
            <ellipse cx="236" cy="184" rx="150" ry="52" />
            <ellipse cx="236" cy="184" rx="150" ry="104" />
            <ellipse cx="236" cy="184" rx="56" ry="150" />
            <ellipse cx="236" cy="184" rx="108" ry="150" />
          </g>
          {PATHS.map((d, index) => (
            <path key={d} d={d} stroke="#fff" strokeOpacity="0.75" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 6"
              mask={`url(#${maskPrefix}-${index})`} />
          ))}
          {CITIES.map((city) => (
            <g key={city.code}>
              <circle cx={city.x} cy={city.y} r="7" fill="#fff" fillOpacity="0.18" />
              <circle cx={city.x} cy={city.y} r="3.5" fill="#fff" />
              <text
                x={city.label === 'left' ? city.x - 12 : city.label === 'right' ? city.x + 12 : city.x}
                y={city.label === 'below' ? city.y + 22 : city.y + 4}
                textAnchor={city.label === 'left' ? 'end' : city.label === 'right' ? 'start' : 'middle'}
                fill="#fff"
                fillOpacity="0.85"
                fontSize="12"
                fontWeight="700"
                letterSpacing="0.06em"
              >
                {city.code}
              </text>
            </g>
          ))}
        </svg>
        {/* Soft pulses on two hubs (resting invisible). */}
        {[CITIES[0]!, CITIES[5]!].map((city, index) => (
          <span key={city.code} className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40 opacity-0 animate-halo"
            style={{ left: city.x, top: city.y, animationDelay: `${index * 1.2}s` }} />
        ))}
        {PLANES.map((plane) => (
          <span
            key={plane.path}
            className="absolute left-0 top-0 flex size-7 items-center justify-center animate-fly-loop"
            style={{
              offsetPath: `path('${PATHS[plane.path]}')`,
              offsetRotate: 'auto 45deg',
              offsetDistance: plane.rest,
              animationDuration: plane.duration,
              animationDelay: plane.delay,
            }}
          >
            <Plane className="size-5 fill-white text-white drop-shadow-[0_3px_6px_rgb(0_0_0/0.35)]" strokeWidth={1.5} />
          </span>
        ))}

        {/* A boarding pass (bottom left). */}
        <div className="absolute -bottom-6 -left-10 w-52 animate-float rounded-2xl bg-white p-3.5 text-slate-900 shadow-2xl ring-1 ring-slate-900/5">
          <div className="flex items-center justify-between text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500">
            Boarding pass
            <span className="flex size-6 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Plane className="size-3.5 rotate-45 text-white" />
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xl font-extrabold tracking-tight">DEL</span>
            <span className="relative h-px flex-1 border-t-2 border-dashed border-slate-300" />
            <span className="text-xl font-extrabold tracking-tight">BOM</span>
          </div>
          <div className="mt-3 h-6 rounded bg-[repeating-linear-gradient(90deg,var(--color-slate-800)_0_2px,transparent_2px_4px,var(--color-slate-800)_4px_5px,transparent_5px_8px)] opacity-80" />
        </div>

        {/* A confirmed stay (top right). */}
        <div className="absolute -right-8 -top-5 flex w-52 animate-float items-center gap-3 rounded-2xl bg-white p-3 text-slate-900 shadow-2xl ring-1 ring-slate-900/5 [animation-delay:-3s]">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white">
            <BedDouble className="size-5 text-white" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold">Hotel stay</span>
            <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-success-700">
              <CircleCheck className="size-3.5 text-current" /> Confirmed
            </span>
          </span>
        </div>

        {/* Live updates (bottom right). */}
        <div className="absolute -bottom-4 right-6 flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-xl animate-pop [animation-delay:1.6s]">
          <span className="relative flex size-2">
            <span className="absolute inset-0 rounded-full bg-success-500 opacity-0 animate-halo" />
            <span className="relative size-2 rounded-full bg-success-500" />
          </span>
          Live booking updates
        </div>
      </div>
    </div>
  );
}
