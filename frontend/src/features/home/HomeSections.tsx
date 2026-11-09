import { useEffect, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  Armchair, ArrowRight, ArrowUpRight, BadgePercent, BedDouble, CalendarCheck, CalendarDays, ChevronDown, Compass, History,
  LifeBuoy, MapPin, MessageSquareQuote, Moon, Plane, Quote, Search, ShieldCheck, Star, Trash2, Users, X, Zap,
  type LucideIcon,
} from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { Reveal } from '@/components/motion/Reveal';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { StarScore } from '@/components/ui/StarRatingInput';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { defaultFlightSearch, flightQueryOf } from '@/features/flights/searchParams';
import { FAQ } from '@/features/help/faq';
import { DemoBadge, GuestRating, StarRating } from '@/features/hotels/HotelBadges';
import { hotelApi } from '@/features/hotels/hotelApi';
import { defaultStay, EMPTY_FILTERS, searchParamsOf } from '@/features/hotels/searchParams';
import { offerApi, OFFERS_STALE_MS } from '@/features/offers/offerApi';
import { OfferCard } from '@/features/offers/OfferCard';
import { reviewApi } from '@/features/reviews/reviewApi';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { hasAnyRole } from '@/lib/auth/types';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { homeApi, mergeDestinations, MIN_POPULAR_DESTINATIONS, SUGGESTED_ROUTES, type PopularFlightRoute, type RecommendedHotel } from './homeApi';
import {
  clearRecentSearches, recentSearchPath, removeRecentSearch, restoreRecentSearches, summarizeRecentSearch, useRecentSearches,
} from './recentSearches';

/** Public home page data changes slowly; one fetch per 10 minutes is plenty. */
const STALE_MS = 10 * 60_000;
const OFFERS_ON_HOME = 3;
const MIN_POPULAR_ROUTES = 3;

const hotelSearchPath = (city: string) =>
  `/hotels/search?${searchParamsOf({ destination: city, stay: defaultStay(), filters: EMPTY_FILTERS }).toString()}`;
const flightSearchPath = (route: Pick<PopularFlightRoute, 'origin' | 'destination'>) =>
  `/flights/search?${flightQueryOf({ ...defaultFlightSearch(), origin: route.origin, destination: route.destination }).toString()}`;

/**
 * Card rows that scroll sideways on phones (inside their own box, snapping to each card) and become a grid from `sm`
 * up, so a phone does not get a very long column of large cards.
 */
const carouselList =
  '-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-3 pt-1 sm:mx-0 sm:pt-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3';
const carouselItem = 'w-[80%] max-w-sm shrink-0 snap-start sm:w-auto sm:max-w-none';

/** "See all offers →": a pill link with an arrow that nudges on hover. */
export function MoreLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="group inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-xs ring-1 ring-inset ring-slate-200 transition-[box-shadow,background-color] duration-(--duration-fast) hover:bg-brand-50 hover:ring-brand-200"
    >
      {children}
      <ArrowRight className="size-4 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

/** A home page section (eyebrow pill, h2, description, action on the right). Below the fold it fades in on scroll. */
function HomeSection({ id, eyebrow, icon: Icon, title, description, action, reveal = true, children }: {
  id: string;
  eyebrow?: string;
  /** The eyebrow's icon. */
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** false for sections that can be in the first screen (they must not wait for a scroll). */
  reveal?: boolean;
  children: ReactNode;
}) {
  const body = (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow && (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent-700 ring-1 ring-inset ring-accent-100">
              {Icon && <Icon className="size-3.5 text-current" aria-hidden="true" />}
              {eyebrow}
            </p>
          )}
          <h2 id={`${id}-heading`} className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h2>
          {description && <p className="mt-1.5 max-w-2xl text-sm text-slate-600 sm:text-base">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-6">{children}</div>
    </>
  );
  const className = 'mx-auto mt-16 max-w-7xl px-4 sm:mt-20 sm:px-6';
  return reveal ? (
    <Reveal as="section" aria-labelledby={`${id}-heading`} className={className}>{body}</Reveal>
  ) : (
    <section aria-labelledby={`${id}-heading`} className={className}>{body}</section>
  );
}

/** A section that could not load: the error look (compact) with the support reference and a retry. */
function SectionProblem({ text, error, onRetry }: { text: string; error: unknown; onRetry: () => void }) {
  const problem = ApiError.from(error);
  return <ErrorState compact illustration="none" title={text} description={problem.message} correlationId={problem.correlationId} onRetry={onRetry} />;
}

/** Placeholders in the shape of the cards that are coming, with a status for screen readers. */
function TilesLoading({ label, count = 4, shape = 'tile' }: { label: string; count?: number; shape?: 'tile' | 'card' | 'quote' }) {
  const grid = shape === 'tile' ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3';
  return (
    <div>
      <span role="status" className="sr-only">{label}</span>
      <div className={cn('grid gap-4', grid)} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-3xl border border-slate-200/80 bg-white p-4 shadow-card">
            {shape === 'card' && <Skeleton className="aspect-[4/3] w-full rounded-2xl" />}
            {shape === 'tile' ? (
              <div className="flex items-center gap-3">
                <Skeleton className="size-11 shrink-0 rounded-xl" />
                <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                {shape === 'quote' && <Skeleton className="mt-2 h-3 w-1/3" />}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Facts about what the product does (never numbers or claims with figures), each with its own gradient tile. */
const FEATURES: { icon: LucideIcon; title: string; text: string; tile: string; glow: string }[] = [
  { icon: ShieldCheck, title: 'Secure payments', text: 'Pay in a trusted checkout. Card details never reach our servers.',
    tile: 'from-violet-500 to-indigo-600', glow: 'bg-violet-400/20' },
  { icon: Zap, title: 'Live booking updates', text: 'See your booking go from held to confirmed without reloading the page.',
    tile: 'from-amber-400 to-orange-500', glow: 'bg-amber-300/25' },
  { icon: CalendarCheck, title: 'Flexible stays', text: 'Filter for free cancellation and see your refund before you cancel.',
    tile: 'from-emerald-500 to-teal-600', glow: 'bg-emerald-300/25' },
  { icon: LifeBuoy, title: 'Help when you need it', text: 'Open a support ticket from your account, linked to your booking.',
    tile: 'from-sky-500 to-blue-600', glow: 'bg-sky-300/25' },
];

/** "Why book with us": four product features as cards under the search; they come in one after another. */
export function WhyBookSection() {
  return (
    <section aria-labelledby="why-heading" className="mx-auto mt-12 max-w-7xl px-4 sm:px-6">
      <h2 id="why-heading" className="sr-only">Why book with us</h2>
      <ul className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, text, tile, glow }) => (
          <li key={title} className="group relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 shadow-card hover-lift">
            <span aria-hidden="true" className={cn('absolute -right-10 -top-10 size-32 rounded-full blur-2xl transition-transform duration-(--duration-slow) ease-out-soft group-hover:scale-150', glow)} />
            <span aria-hidden="true" className={cn('relative flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition-transform duration-(--duration-base) ease-spring group-hover:-rotate-6 group-hover:scale-110', tile)}>
              <Icon className="size-6 text-white" />
            </span>
            <h3 className="relative mt-4 text-base font-bold text-slate-900">{title}</h3>
            <p className="relative mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A small fact of a saved search ("Sun, 22 Nov", "2 adults · 1 room") with its icon. */
function SearchFact({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200/80">
      <Icon className="size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * The last hotel and flight searches on this device (nothing at all when there are none). Each card says what it was
 * (type, place, dates, travellers) and runs the search again; "×" forgets one and "Clear all" every one, both with an
 * "Undo" in the toast. After removing one, focus moves to the next card's "×" (or to "Clear all").
 */
export function RecentSearchesSection() {
  const searches = useRecentSearches();
  const removeButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const clearButton = useRef<HTMLButtonElement>(null);
  const focusAfterRemove = useRef<number | null>(null);

  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) return;
    focusAfterRemove.current = null;
    (removeButtons.current[Math.min(index, searches.length - 1)] ?? clearButton.current)?.focus();
  }, [searches]);

  if (searches.length === 0) {
    return null;
  }

  const undoTo = (previous: typeof searches) => ({ label: 'Undo', onClick: () => void restoreRecentSearches(previous) });
  const clearAll = () => {
    const previous = searches;
    clearRecentSearches();
    toast.success('Recent searches cleared', { action: undoTo(previous) });
  };
  const removeOne = (index: number, title: string) => {
    const previous = searches;
    focusAfterRemove.current = index;
    removeRecentSearch(searches[index]!);
    toast.success(`${title} removed from recent searches`, { action: undoTo(previous) });
  };

  return (
    <HomeSection
      id="recent-searches"
      eyebrow="Pick up where you left off"
      icon={History}
      title="Your recent searches"
      description="Saved on this device only."
      reveal={false}
      action={(
        <button
          ref={clearButton}
          type="button"
          onClick={clearAll}
          aria-label="Clear all recent searches"
          className="group inline-flex h-10 items-center gap-2 rounded-full border border-slate-300/90 bg-white px-4 text-sm font-semibold text-slate-700 shadow-xs transition-[background-color,border-color,color,box-shadow] duration-(--duration-fast) hover:border-danger-200 hover:bg-danger-50 hover:text-danger-700 hover:shadow-sm active:translate-y-px"
        >
          <Trash2 className="size-4 text-current transition-transform duration-(--duration-base) ease-spring group-hover:-rotate-12 group-hover:scale-110" aria-hidden="true" />
          Clear all
        </button>
      )}
    >
      <ul className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Recent searches">
        {searches.map((entry, index) => {
          const summary = summarizeRecentSearch(entry);
          const hotel = entry.kind === 'HOTEL';
          const Icon = hotel ? BedDouble : Plane;
          return (
            <li key={`${entry.kind}-${entry.savedAt}-${summary.title}`} className="relative min-w-0">
              <Link
                to={recentSearchPath(entry)}
                className="group flex h-full flex-col rounded-3xl border border-slate-200/80 bg-white p-5 shadow-card hover-lift hover:border-brand-200"
              >
                <span className="flex items-start gap-3.5 pr-9">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition-transform duration-(--duration-base) ease-spring group-hover:-rotate-6 group-hover:scale-105',
                      hotel ? 'from-teal-500 to-emerald-600' : 'from-blue-500 to-indigo-600',
                    )}
                  >
                    <Icon className="size-6 text-white" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span aria-hidden="true" className={cn('block text-xs font-bold uppercase tracking-wider', hotel ? 'text-teal-700' : 'text-brand-700')}>
                      {summary.type}
                    </span>
                    <span className="mt-0.5 block text-base font-bold leading-snug text-slate-900">
                      <span className="sr-only">{hotel ? 'Hotels in' : 'Flights:'}</span>{' '}{summary.title}
                    </span>
                  </span>
                </span>
                <span className="mb-4 mt-4 flex flex-wrap gap-1.5">
                  <SearchFact icon={CalendarDays}>{summary.dates}</SearchFact>{' '}
                  <SearchFact icon={Users}>{summary.people}</SearchFact>{' '}
                  <SearchFact icon={hotel ? Moon : Armchair}>{summary.extra}</SearchFact>
                </span>
                <span className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-3.5">
                  <span className={cn('min-w-0 text-xs', summary.moved ? 'font-medium text-info-700' : 'text-slate-500')}>
                    {summary.moved ? 'New dates: the saved ones have passed' : summary.searched}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700">
                    Search again
                    <ArrowRight className="size-4 transition-transform duration-(--duration-base) ease-out-soft group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </span>
              </Link>
              <button
                ref={(element) => { removeButtons.current[index] = element; }}
                type="button"
                onClick={() => removeOne(index, summary.title)}
                aria-label={`Remove ${summary.title} from recent searches`}
                className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full text-slate-500 transition-colors duration-(--duration-fast) hover:bg-danger-50 hover:text-danger-600"
              >
                <X className="size-4 text-current" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </HomeSection>
  );
}

/** Special offers and seasonal promotions (the newest few; all of them on /offers). */
export function OffersSection() {
  const offers = useQuery({ queryKey: queryKeys.publicContent.offers, queryFn: offerApi.list, staleTime: OFFERS_STALE_MS });
  return (
    <HomeSection
      id="offers"
      eyebrow="Deals"
      icon={BadgePercent}
      title="Special offers"
      description="Deals and seasonal promotions. Copy a code and use it when you book."
      action={<MoreLink to="/offers">See all offers</MoreLink>}
    >
      {offers.isPending && <TilesLoading label="Loading offers…" count={3} shape="quote" />}
      {offers.isError && <SectionProblem text="Offers could not be loaded." error={offers.error} onRetry={() => void offers.refetch()} />}
      {offers.data && offers.data.length === 0 && (
        <EmptyState compact title="No offers right now" description="Check back soon: new deals appear here." />
      )}
      {offers.data && offers.data.length > 0 && (
        <ul className={carouselList} aria-label="Special offers">
          {offers.data.slice(0, OFFERS_ON_HOME).map((offer) => <li key={offer.id} className={carouselItem}><OfferCard offer={offer} /></li>)}
        </ul>
      )}
    </HomeSection>
  );
}

/**
 * Postcard colours for the destinations (dark enough for white text: every pair is a 700 or 800 step). They rotate, so
 * neighbouring cities never share one.
 */
const POSTCARDS = [
  'from-sky-700 to-indigo-800',
  'from-rose-700 to-orange-700',
  'from-emerald-700 to-teal-800',
  'from-violet-700 to-fuchsia-800',
  'from-amber-700 to-orange-800',
  'from-cyan-700 to-blue-800',
];
/** Extra columns for the last postcard on large screens, so the bento grid ends with a full row (index = columns). */
const LG_SPAN = ['', '', 'lg:col-span-2', 'lg:col-span-3', 'lg:col-span-4'];

/**
 * Popular destinations (paid bookings of the last 90 days). A new system has few or none: the cities that have hotels
 * fill the list, and the description says so. Shown as colourful postcards; with five or more the first one is large.
 */
export function DestinationsSection() {
  const popular = useQuery({
    queryKey: queryKeys.publicContent.popularDestinations,
    queryFn: () => homeApi.popularDestinations(8),
    staleTime: STALE_MS,
  });
  const needCatalogue = popular.isError || (popular.isSuccess && popular.data.length < MIN_POPULAR_DESTINATIONS);
  const catalogue = useQuery({
    queryKey: queryKeys.hotels.destinations(''),
    queryFn: () => hotelApi.destinations(''),
    enabled: needCatalogue,
    staleTime: STALE_MS,
  });
  const loading = popular.isPending || (needCatalogue && catalogue.isPending);
  const failed = popular.isError && catalogue.isError;
  const items = loading ? [] : mergeDestinations(popular.data, needCatalogue ? catalogue.data : undefined);
  const hasPopular = (popular.data?.length ?? 0) > 0;
  const description = !needCatalogue
    ? 'Where travellers booked most in the last 90 days.'
    : hasPopular ? 'Popular right now, and more cities with hotels.' : 'Cities with hotels you can book.';
  const bento = items.length >= 5;
  // Large screens: the first postcard takes 2 × 2 cells; the last one widens to fill the final row.
  const lastSpan = bento ? (4 - ((items.length + 3) % 4)) % 4 : 0;

  return (
    <HomeSection id="destinations" eyebrow="Explore" icon={Compass} title="Popular destinations" description={description}>
      {loading && <TilesLoading label="Loading destinations…" />}
      {failed && (
        <SectionProblem text="Destinations could not be loaded." error={catalogue.error}
          onRetry={() => { void popular.refetch(); void catalogue.refetch(); }} />
      )}
      {!loading && !failed && items.length === 0 && (
        <EmptyState compact illustration="search" title="No destinations yet" description="Cities appear here as soon as hotels can be booked there." />
      )}
      {items.length > 0 && (
        <ul className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:auto-rows-[9.5rem] lg:grid-cols-4" aria-label="Destinations">
          {items.map((item, index) => {
            const big = bento && index === 0;
            const last = index === items.length - 1;
            return (
              <li
                key={item.city}
                className={cn(
                  big && 'col-span-2 lg:row-span-2',
                  last && lastSpan > 0 && LG_SPAN[lastSpan + 1],
                  // Phones (two columns): a lone last postcard takes the whole row.
                  last && (bento ? items.length % 2 === 0 : items.length % 2 === 1) && 'col-span-2',
                )}
              >
                <Link
                  to={hotelSearchPath(item.city)}
                  className={cn(
                    'group relative flex h-full flex-col justify-end overflow-hidden rounded-3xl bg-gradient-to-br p-4 text-white shadow-card hover-lift sm:p-5',
                    big ? 'min-h-[12rem]' : 'min-h-[8.5rem]',
                    POSTCARDS[index % POSTCARDS.length],
                  )}
                >
                  <span aria-hidden="true" className="absolute -right-8 -top-8 size-36 rounded-full bg-white/10 transition-transform duration-(--duration-slow) ease-out-soft group-hover:scale-125" />
                  <span aria-hidden="true" className="absolute -bottom-10 left-1/3 size-28 rounded-full bg-white/5" />
                  <MapPin
                    aria-hidden="true"
                    className={cn(
                      'absolute rotate-12 text-white/15 transition-transform duration-(--duration-slow) ease-out-soft group-hover:-translate-y-1 group-hover:rotate-0',
                      big ? 'right-8 top-10 size-28' : 'right-4 top-8 size-16',
                    )}
                  />
                  <span aria-hidden="true" className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/30 backdrop-blur-sm transition-transform duration-(--duration-base) ease-out-soft group-hover:rotate-45 sm:right-4 sm:top-4">
                    <ArrowUpRight className="size-4 text-white" />
                  </span>
                  <span className={cn('relative block font-bold tracking-tight', big ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl')}>{item.city}</span>
                  <span className="relative mt-0.5 block text-sm font-medium text-white/90">{item.note}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </HomeSection>
  );
}

/** Highly rated hotels with their cover photo (served by the API). */
export function RecommendedHotelsSection() {
  const hotels = useQuery({
    queryKey: queryKeys.publicContent.recommendedHotels,
    queryFn: () => homeApi.recommendedHotels(6),
    staleTime: STALE_MS,
  });
  return (
    <HomeSection id="recommended" eyebrow="Stay" icon={BedDouble} title="Recommended hotels" description="Guests' favourites, by rating."
      action={<MoreLink to="/hotels">Search all hotels</MoreLink>}>
      {hotels.isPending && <TilesLoading label="Loading hotels…" count={3} shape="card" />}
      {hotels.isError && <SectionProblem text="Hotels could not be loaded." error={hotels.error} onRetry={() => void hotels.refetch()} />}
      {hotels.data && hotels.data.length === 0 && (
        <EmptyState compact title="No hotels to recommend yet" description="Guests' favourites appear here once hotels have reviews." />
      )}
      {hotels.data && hotels.data.length > 0 && (
        <ul className={carouselList} aria-label="Recommended hotels">
          {hotels.data.map((hotel) => <li key={hotel.id} className={carouselItem}><HotelTile hotel={hotel} /></li>)}
        </ul>
      )}
    </HomeSection>
  );
}

function HotelTile({ hotel }: { hotel: RecommendedHotel }) {
  return (
    <Link to={`/hotels/${hotel.slug}`} className="group block h-full rounded-3xl">
      <Card interactive className="flex h-full flex-col overflow-hidden rounded-3xl group-hover:border-brand-200">
        <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-brand-100 via-brand-50 to-accent-50">
          {hotel.imageUrl ? (
            <img src={hotel.imageUrl} alt="" loading="lazy"
              className="size-full object-cover transition-transform duration-(--duration-slower) ease-out-soft group-hover:scale-110" />
          ) : (
            <span aria-hidden="true" className="flex size-full items-center justify-center">
              <BedDouble className="size-12 text-brand-300" />
            </span>
          )}
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-slate-950/45 to-transparent" />
          {hotel.demo && <DemoBadge className="absolute left-3 top-3 shadow-sm" />}
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-sm">
            <MapPin className="size-3.5 shrink-0 text-brand-600" aria-hidden="true" />{hotel.city}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-4 sm:p-5">
          <StarRating stars={hotel.starRating} />
          <h3 className="text-base font-bold text-slate-900 group-hover:text-brand-700">{hotel.name}</h3>
          <GuestRating rating={hotel.guestRating} reviews={hotel.reviewCount} />
          {hotel.priceFrom !== null && (
            <p className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
              <span className="flex items-baseline gap-1">
                from <span className="text-lg font-bold text-slate-900">{formatMoney(hotel.priceFrom)}</span> per night
              </span>
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors duration-(--duration-fast) group-hover:bg-brand-600 group-hover:text-white">
                <ArrowRight className="size-4 text-current" />
              </span>
            </p>
          )}
        </div>
      </Card>
    </Link>
  );
}

/**
 * Popular flight routes (paid bookings of the last 90 days). With fewer than three, or when they cannot be loaded,
 * suggested routes fill the list, each labelled "Suggested". Each route is a ticket: on hover its plane flies on.
 */
export function PopularRoutesSection() {
  const routes = useQuery({ queryKey: queryKeys.publicContent.popularRoutes, queryFn: () => homeApi.popularRoutes(6), staleTime: STALE_MS });
  if (routes.isPending) {
    return <HomeSection id="routes" eyebrow="Fly" icon={Plane} title="Popular flight routes"><TilesLoading label="Loading flight routes…" /></HomeSection>;
  }
  const popular = routes.data ?? [];
  const items: { route: PopularFlightRoute; suggested: boolean }[] = popular.map((route) => ({ route, suggested: false }));
  if (items.length < MIN_POPULAR_ROUTES) {
    const known = new Set(items.map(({ route }) => `${route.origin}-${route.destination}`));
    for (const route of SUGGESTED_ROUTES) {
      if (!known.has(`${route.origin}-${route.destination}`)) items.push({ route, suggested: true });
    }
  }
  const onlySuggestions = popular.length === 0;
  return (
    <HomeSection
      id="routes"
      eyebrow="Fly"
      icon={Plane}
      title={onlySuggestions ? 'Suggested flight routes' : 'Popular flight routes'}
      description={onlySuggestions ? 'Ideas to get you started. Prices appear when you search.' : 'Routes travellers booked most in the last 90 days.'}
    >
      {/* Phones: a row of tickets that scrolls sideways (like the offers); a grid from sm. */}
      <ul className={cn(carouselList.replace('lg:grid-cols-3', 'lg:grid-cols-4'), 'stagger')} aria-label="Flight routes">
        {items.map(({ route, suggested }) => (
          <li key={`${route.origin}-${route.destination}`} className={carouselItem}>
            <Link to={flightSearchPath(route)} className="group flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-card hover-lift hover:border-brand-200">
              <span className="block px-5 pb-4 pt-5">
                <span aria-hidden="true" className="flex items-end justify-between gap-3">
                  <span className="text-2xl font-extrabold tracking-tight text-slate-900">{route.origin}</span>
                  <span className="relative mb-2 h-7 flex-1">
                    <svg viewBox="0 0 100 28" preserveAspectRatio="none" fill="none" className="absolute inset-0 size-full overflow-visible">
                      <path d="M2 26 Q 50 -8 98 26" stroke="var(--color-slate-300)" strokeWidth="2" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
                    </svg>
                    <span className="absolute left-1/2 top-0 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand-600 text-white shadow-glow transition-transform duration-(--duration-slow) ease-out-soft group-hover:translate-x-[60%] group-hover:translate-y-0">
                      <Plane className="size-3.5 rotate-45 text-white" />
                    </span>
                  </span>
                  <span className="text-2xl font-extrabold tracking-tight text-slate-900">{route.destination}</span>
                </span>
                <span className="mt-2 block font-semibold text-slate-900">{route.originCity} to {route.destinationCity}</span>
              </span>
              {/* The ticket's stub, behind a perforated line. */}
              <span className="relative mt-auto flex items-center justify-between gap-2 border-t-2 border-dashed border-slate-200 bg-slate-50/80 px-5 py-3 text-sm text-slate-600">
                <span aria-hidden="true" className="absolute -left-3 -top-3 size-6 rounded-full border border-slate-200/80 bg-canvas" />
                <span aria-hidden="true" className="absolute -right-3 -top-3 size-6 rounded-full border border-slate-200/80 bg-canvas" />
                <span className="flex flex-wrap items-center gap-2">
                  <span className="sr-only">{route.origin} – {route.destination} ·</span>
                  {suggested ? <Badge tone="neutral">Suggested</Badge> : `${route.bookings ?? 0} booking${route.bookings === 1 ? '' : 's'} recently`}
                </span>
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 transition-colors duration-(--duration-fast) group-hover:bg-brand-600 group-hover:text-white group-hover:ring-brand-600">
                  <Search className="size-3.5 text-current" />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </HomeSection>
  );
}

/** Recent 4 and 5 star reviews from guests. */
export function FeaturedReviewsSection() {
  const reviews = useQuery({ queryKey: queryKeys.reviews.featured, queryFn: () => reviewApi.featured(6), staleTime: STALE_MS });
  return (
    <HomeSection id="reviews" eyebrow="Reviews" icon={MessageSquareQuote} title="What guests say" description="Recent reviews from guests who stayed with us.">
      {reviews.isPending && <TilesLoading label="Loading reviews…" count={3} shape="quote" />}
      {reviews.isError && <SectionProblem text="Reviews could not be loaded." error={reviews.error} onRetry={() => void reviews.refetch()} />}
      {reviews.data && reviews.data.length === 0 && (
        <EmptyState compact title="No reviews yet" description="Guests can review their stay after check-out." />
      )}
      {reviews.data && reviews.data.length > 0 && (
        <ul className={carouselList} aria-label="Guest reviews">
          {reviews.data.map((review) => (
            <li key={review.id} className={carouselItem}>
              <Card className="relative flex h-full flex-col gap-3 overflow-hidden rounded-3xl p-5 hover-lift sm:p-6">
                <span aria-hidden="true" className="absolute -right-12 -top-12 size-36 rounded-full bg-brand-100/60 blur-2xl" />
                <span aria-hidden="true" className="absolute right-5 top-5 flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 shadow-lg">
                  <Quote className="size-5 fill-white/30 text-white" />
                </span>
                <StarScore rating={review.rating} />
                <h3 className="relative pr-12 text-base font-bold text-slate-900">{review.title}</h3>
                <p className="relative line-clamp-4 text-sm leading-relaxed text-slate-700">{review.text}</p>
                <div className="relative mt-auto flex items-center gap-3 border-t border-slate-100 pt-3">
                  <Avatar name={review.authorName} size="md" />
                  <p className="min-w-0 text-xs text-slate-600">
                    <span className="block text-sm font-semibold text-slate-900">{review.authorName}</span>
                    {review.hotelSlug
                      ? <Link to={`/hotels/${review.hotelSlug}`} className="font-semibold text-brand-700 hover:underline">{review.hotelName}</Link>
                      : review.hotelName}
                    {review.city ? `, ${review.city}` : ''}
                  </p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </HomeSection>
  );
}

const darkPrimary =
  'group inline-flex h-12 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-brand-800 shadow-lg transition-colors duration-(--duration-fast) hover:bg-brand-50';
const darkSecondary =
  'inline-flex h-12 items-center gap-2 rounded-xl bg-white/10 px-5 text-sm font-semibold text-white ring-1 ring-inset ring-white/30 backdrop-blur-sm transition-colors duration-(--duration-fast) hover:bg-white/20';

/** The arc in the closing band, in the arc box's own pixels (the plane follows it with `offset-path`). */
const BAND_ARC = 'M 10 110 C 90 10, 230 10, 310 70';

/**
 * Near the end of the page: where to go next, on a drifting gradient band with a plane looping over a dashed arc
 * (decorative, from md). Customers get their trips; visitors get the sign-up.
 */
export function NextTripBand() {
  const { user } = useAuth();
  const customer = hasAnyRole(user, ['CUSTOMER']);
  return (
    <Reveal as="section" aria-labelledby="next-trip-heading" className="mx-auto mt-16 max-w-7xl px-4 sm:mt-20 sm:px-6">
      <div
        className={cn(
          'relative isolate overflow-hidden rounded-3xl px-6 py-10 text-white shadow-xl sm:px-10 sm:py-12',
          'bg-[linear-gradient(120deg,var(--role-950),var(--role-800)_40%,var(--color-violet-700)_75%,var(--role-800))] bg-[length:220%_220%] animate-gradient-pan',
        )}
      >
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-grid-faint" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(26rem_16rem_at_90%_10%,color-mix(in_srgb,var(--color-accent-400)_28%,transparent),transparent)]" />
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent-100 ring-1 ring-inset ring-white/20">
              <Star className="size-3.5 fill-current text-current" aria-hidden="true" /> Your next trip
            </p>
            <h2 id="next-trip-heading" className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Ready when you are</h2>
            <p className="mt-2 text-base leading-relaxed text-brand-50">
              {customer
                ? 'Find a flight or a hotel for your next trip, or check on the trips you have booked.'
                : 'Create a free account to book, pay securely and follow every booking live.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {customer ? (
                <>
                  <Link to="/flights" className={darkPrimary}>
                    <Plane className="size-4" aria-hidden="true" /> Search flights
                    <ArrowRight className="size-4 transition-transform duration-(--duration-base) group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>
                  <Link to="/my-trips" className={darkSecondary}>View my trips</Link>
                </>
              ) : (
                <>
                  <Link to="/register" className={darkPrimary}>
                    Create a free account
                    <ArrowRight className="size-4 transition-transform duration-(--duration-base) group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>
                  <Link to="/hotels" className={darkSecondary}>Browse hotels</Link>
                </>
              )}
            </div>
          </div>
          <div aria-hidden="true" className="relative hidden h-[120px] w-[320px] shrink-0 md:block">
            <svg viewBox="0 0 320 120" width="320" height="120" fill="none" className="absolute inset-0 overflow-visible">
              <path d={BAND_ARC} stroke="#fff" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 7" />
              <circle cx="10" cy="110" r="5" fill="#fff" />
              <circle cx="310" cy="70" r="9" stroke="#fff" strokeOpacity="0.5" />
              <circle cx="310" cy="70" r="4.5" fill="#fff" />
            </svg>
            <span
              className="absolute left-0 top-0 flex size-9 items-center justify-center animate-fly-loop"
              style={{ offsetPath: `path('${BAND_ARC}')`, offsetRotate: 'auto 45deg', offsetDistance: '60%', animationDuration: '6s' }}
            >
              <Plane className="size-7 fill-white text-white drop-shadow-[0_4px_10px_rgb(0_0_0/0.35)]" strokeWidth={1.5} />
            </span>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

/** Three common questions; the rest on /help. */
export function FaqTeaser() {
  const questions = FAQ.slice(0, 3).flatMap((section) => section.items.slice(0, 1).map((item) => ({ ...item, sectionId: section.id })));
  return (
    <HomeSection id="faq" eyebrow="Help" icon={LifeBuoy} title="Questions?" action={<MoreLink to="/help">All answers in Help & Support</MoreLink>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="divide-y divide-slate-100 rounded-3xl">
          {questions.map((item) => (
            <details key={item.question} className="group px-5 py-4 sm:px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                {item.question}
                <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-[transform,background-color] duration-(--duration-base) group-open:rotate-180 group-open:bg-brand-600 group-open:text-white">
                  <ChevronDown className="size-4 text-current" />
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-700 animate-slide-down">{item.answer}</p>
              <Link to={`/help#${item.sectionId}`} className="mt-2 inline-block rounded text-sm font-semibold text-brand-700 hover:underline">More about this</Link>
            </details>
          ))}
        </Card>
        <Card variant="tinted" className="relative flex flex-col items-start gap-3 overflow-hidden rounded-3xl p-6">
          <span aria-hidden="true" className="absolute -right-10 -top-10 size-32 rounded-full bg-sky-300/30 blur-2xl" />
          <span aria-hidden="true" className="relative flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg">
            <LifeBuoy className="size-6 text-white" />
          </span>
          <h3 className="relative text-base font-bold text-slate-900">Need a hand with a booking?</h3>
          <p className="relative text-sm leading-relaxed text-slate-700">
            Our support team sees your booking, so you never have to explain twice.
          </p>
          <ButtonLink to="/contact" variant="secondary" size="sm" className="relative mt-auto">Contact us</ButtonLink>
        </Card>
      </div>
    </HomeSection>
  );
}
