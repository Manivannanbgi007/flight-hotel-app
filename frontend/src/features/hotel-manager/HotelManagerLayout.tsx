import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import {
  BarChart3, BedDouble, Building2, CalendarDays, ClipboardList, DoorOpen, ExternalLink, Hotel, Image, LayoutDashboard, MapPin, MessageSquare,
  Star,
} from 'lucide-react';

import { toStatChange } from '@/components/analytics/growth';
import { formatCount, formatINR, formatPercent } from '@/components/charts';
import { HotelIllustration } from '@/components/illustrations';
import { StaffShell } from '@/components/layout/staff/StaffShell';
import type { StaffNavSection } from '@/components/layout/staff/staffNav';
import { Badge } from '@/components/ui/Badge';
import type { Crumb } from '@/components/ui/Breadcrumbs';
import { buttonClass } from '@/components/ui/buttonStyles';
import { Card } from '@/components/ui/Card';
import { selectClass } from '@/components/ui/fieldStyles';
import { Skeleton } from '@/components/ui/Skeleton';
import { TrendChip } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/StateViews';
import { TabLinks } from '@/components/ui/Tabs';
import { DemoBadge } from '@/features/hotels/HotelBadges';
import { GlobalSearch } from '@/features/search/GlobalSearch';
import { SEARCH_PATHS } from '@/features/search/searchModel';
import { ApiError } from '@/lib/api/apiError';
import { cn } from '@/lib/cn';
import { FactChip } from './ManagerParts';
import { PortfolioOverview } from './PortfolioOverview';
import { usePortfolioDashboard } from './useHotelDashboard';
import { useManagerHotels } from './useManagerHotels';
import { HOTEL_STATUS_LABELS, type HotelSummary } from './types';

/** The hotel's sections in four groups: what is happening, what is on sale, what guests and numbers say, the property. */
const TAB_GROUPS = [
  { title: 'Overview', tabs: [{ to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    title: 'Operations',
    tabs: [
      { to: 'reservations', label: 'Reservations', icon: ClipboardList },
      { to: 'rooms', label: 'Rooms & rates', icon: BedDouble },
      { to: 'inventory', label: 'Inventory calendar', icon: CalendarDays },
    ],
  },
  {
    title: 'Guests and insight',
    tabs: [
      { to: 'reviews', label: 'Reviews', icon: MessageSquare },
      { to: 'reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    title: 'Property',
    tabs: [
      { to: 'profile', label: 'Profile', icon: Hotel },
      { to: 'photos', label: 'Photos', icon: Image },
    ],
  },
];
const TABS = TAB_GROUPS.flatMap((group) => group.tabs);

const statusTone = (status: HotelSummary['status']) => (status === 'ACTIVE' ? 'success' : status === 'DRAFT' ? 'warning' : 'neutral');

/**
 * Hotel manager portal (lazy-loaded; RequireRole HOTEL_MANAGER or ADMIN) in the staff shell (teal). The API only returns
 * assigned hotels. The header has the global search (the managed hotels' reservations, reviews and pages); its results
 * page (/hotel-manager/search) brings its own heading instead of the hotel's.
 */
export function HotelManagerLayout() {
  const { hotelId } = useParams();
  const hotels = useManagerHotels();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onSearchPage = pathname === SEARCH_PATHS['hotel-manager'];
  const current = hotels.data?.find((h) => h.id === hotelId);
  // The hotel switcher keeps the section (a reservation's page goes back to the list of the other hotel).
  const tab = pathname.split('/')[4] ?? 'dashboard';
  const hotelName = current?.name ?? (hotelId ? 'Hotel' : 'My hotels');

  const sections: StaffNavSection[] = [
    { label: 'Hotel manager', groups: [{ title: 'Portal', items: [{ to: '/hotel-manager', label: 'My hotels', icon: Building2, end: true }] }] },
    ...(hotelId
      ? [{
        label: 'Hotel sections',
        groups: TAB_GROUPS.map((group) => ({
          title: group.title,
          items: group.tabs.map(({ to, label, icon }) => ({ to: `/hotel-manager/hotels/${hotelId}/${to}`, label, icon })),
        })),
      }]
      : []),
  ];
  const section = TABS.find((t) => t.to === tab);
  const crumbs: Crumb[] = onSearchPage
    ? [{ label: 'Hotel manager portal', to: '/hotel-manager' }, { label: 'Search results' }]
    : hotelId
    ? [
      { label: 'Hotel manager portal', to: '/hotel-manager' },
      { label: hotelName, to: `/hotel-manager/hotels/${hotelId}/dashboard` },
      ...(section ? [pathname.split('/').length > 5 ? { label: section.label, to: `/hotel-manager/hotels/${hotelId}/${section.to}` } : { label: section.label }] : []),
      ...(pathname.split('/').length > 5 ? [{ label: 'Details' }] : []),
    ]
    : [{ label: 'Hotel manager portal', to: '/hotel-manager' }, { label: 'My hotels' }];

  return (
    <StaffShell
      role="manager"
      title="Hotel manager portal"
      icon={<Hotel className="size-5" />}
      home="/hotel-manager"
      sections={sections}
      breadcrumbs={crumbs}
      searchSlot={<GlobalSearch placeholder="Search reservations, reviews..." />}
      identity={current ? <HotelIdentity hotel={current} /> : undefined}
    >
      {onSearchPage ? <Outlet /> : <HotelHeader hotelId={hotelId} hotelName={hotelName} current={current} hotels={hotels.data}
        onSwitch={(id) => void navigate(`/hotel-manager/hotels/${id}/${tab}`)} />}
    </StaffShell>
  );
}

/** The top of every hotel page (and of "My hotels"): the hotel's name, city, rating, rooms, status and the hotel switcher. */
function HotelHeader({ hotelId, hotelName, current, hotels, onSwitch }: {
  hotelId: string | undefined;
  hotelName: string;
  current: HotelSummary | undefined;
  hotels: HotelSummary[] | undefined;
  onSwitch: (hotelId: string) => void;
}) {
  return (
    <>
      <header className="relative isolate overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-card animate-fade-up">
        {/* A soft wash of the portal colour from the top left; decoration only. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(90%_140%_at_0%_0%,var(--role-50)_0%,transparent_60%)]" />
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-4">
            <HotelThumb imageUrl={current?.imageUrl ?? null} portfolio={!hotelId} />
            <div className="min-w-0">
              <p className="hidden text-xs font-semibold uppercase tracking-wider text-role-700 sm:block">
                <Link to="/hotel-manager" className="hover:underline">Hotel manager portal</Link>
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="min-w-0 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{hotelName}</h1>
                {current && <Badge tone={statusTone(current.status)} dot>{HOTEL_STATUS_LABELS[current.status]}</Badge>}
              </div>
              {current ? (
                <p className="mt-2 flex flex-wrap items-center gap-1.5">
                  <FactChip icon={<MapPin aria-hidden="true" />}>{current.city}</FactChip>
                  {current.starRating ? (
                    <FactChip icon={<Star aria-hidden="true" className="fill-amber-400 text-amber-400" />}>{current.starRating}-star</FactChip>
                  ) : null}
                  {current.totalRooms ? (
                    // Phones: the city and stars are enough; the rooms are on the Rooms page.
                    <span className="hidden sm:contents"><FactChip icon={<DoorOpen aria-hidden="true" />}>
                      {current.totalRooms} rooms in {current.roomTypes} type{current.roomTypes === 1 ? '' : 's'}
                    </FactChip></span>
                  ) : null}
                  {current.dataSource === 'DEMO' && <DemoBadge />}
                </p>
              ) : !hotelId && (
                <p className="mt-1 max-w-2xl text-sm text-slate-600 sm:text-base">
                  Tonight’s occupancy, today’s arrivals and the last 30 days’ revenue of each hotel you manage.
                </p>
              )}
            </div>
          </div>
          {hotelId && (
            <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
              {current?.status === 'ACTIVE' && (
                <Link to={`/hotels/${current.slug}`} target="_blank" rel="noreferrer" aria-label="Guest view of the hotel page (opens in a new tab)"
                  className={buttonClass({ variant: 'secondary', size: 'sm', className: 'shrink-0' })}>
                  <ExternalLink className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Guest view</span>
                </Link>
              )}
              {hotels && hotels.length > 1 && (
                <label className="flex w-full min-w-0 items-center gap-2 rounded-xl bg-slate-50 py-1 pl-3 pr-1 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 sm:w-auto">
                  <Building2 className="size-4 shrink-0 text-role-600" aria-hidden="true" />
                  Hotel
                  <select value={hotelId} onChange={(e) => onSwitch(e.target.value)}
                    className={cn(selectClass(false, { size: 'sm' }), 'min-w-0 flex-1 sm:w-auto sm:flex-none')}>
                    {hotels.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.city})</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
        {/* Phones and tablets: the sidebar is a drawer there, so the hotel's sections are one tap away as tabs. */}
        {hotelId && (
          <TabLinks
            label="Sections of this hotel"
            className="border-t border-slate-100 px-2 sm:px-3 lg:hidden"
            items={TABS.map(({ to, label, icon: Icon }) => ({
              to: `/hotel-manager/hotels/${hotelId}/${to}`,
              label,
              icon: <Icon className="size-4" aria-hidden="true" />,
            }))}
          />
        )}
      </header>
      <div className="mt-6">
        <Outlet />
      </div>
    </>
  );
}

/** The hotel's cover photo (or an icon tile) in the header. */
function HotelThumb({ imageUrl, portfolio }: { imageUrl: string | null; portfolio: boolean }) {
  if (imageUrl && !portfolio) {
    return (
      <span className="relative size-12 shrink-0 overflow-hidden rounded-2xl bg-role-50 shadow-sm ring-1 ring-slate-900/10 sm:size-16">
        <img src={imageUrl} alt="" className="size-full object-cover" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--role-500),var(--role-700))] text-white shadow-md shadow-role-900/20 ring-1 ring-inset ring-white/20 sm:size-16">
      {portfolio ? <Building2 className="size-7" /> : <Hotel className="size-7" />}
    </span>
  );
}

/** /hotel-manager: the hotels this user manages, each with a few live figures from its own dashboard. */
export function MyHotelsPage() {
  const hotels = useManagerHotels();
  if (hotels.isPending) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <span role="status" className="sr-only">Loading your hotels…</span>
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}
      </div>
    );
  }
  if (hotels.isError) {
    const problem = ApiError.from(hotels.error);
    return (
      <EmptyState illustration="error" title="Your hotels could not be loaded" description={problem.message} />
    );
  }
  if (!hotels.data || hotels.data.length === 0) {
    return <EmptyState illustration={<HotelIllustration className="w-44" />} title="No hotels assigned yet" description="An administrator assigns hotels to your account. Please contact them." />;
  }
  return (
    <div className="flex flex-col gap-8">
      <PortfolioOverview hotels={hotels.data} />
      <section aria-labelledby="your-hotels-title" className="flex flex-col gap-4">
        <h2 id="your-hotels-title" className="text-lg font-bold tracking-tight text-slate-900">Your hotels</h2>
        <ul aria-label="Your hotels" className="grid gap-5 stagger sm:grid-cols-2 xl:grid-cols-3">
          {hotels.data.map((hotel) => <li key={hotel.id} className="min-w-0"><HotelTile hotel={hotel} /></li>)}
        </ul>
      </section>
    </div>
  );
}

/** Who the page is about, in the sidebar: the hotel's photo, name, city and status, linking to its dashboard. */
function HotelIdentity({ hotel }: { hotel: HotelSummary }) {
  return (
    <Link to={`/hotel-manager/hotels/${hotel.id}/dashboard`}
      className="group flex items-center gap-3 rounded-2xl bg-gradient-to-br from-role-50 via-white to-white p-2.5 ring-1 ring-inset ring-role-100 transition-shadow duration-(--duration-fast) hover:shadow-md">
      <span className="relative size-11 shrink-0 overflow-hidden rounded-xl bg-role-100 ring-1 ring-inset ring-role-200">
        {hotel.imageUrl
          ? <img src={hotel.imageUrl} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-110" />
          : <Hotel aria-hidden="true" className="absolute inset-0 m-auto size-5 text-role-600" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-slate-900">{hotel.name}</span>
        <span className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className={cn('size-1.5 rounded-full', hotel.status === 'ACTIVE' ? 'bg-success-500' : hotel.status === 'DRAFT' ? 'bg-warning-500' : 'bg-slate-400')} aria-hidden="true" />
          <span className="truncate">{hotel.city} · {HOTEL_STATUS_LABELS[hotel.status]}</span>
        </span>
      </span>
    </Link>
  );
}

function HotelTile({ hotel }: { hotel: HotelSummary }) {
  return (
    <Card interactive className="group relative flex h-full flex-col overflow-hidden hover:border-role-200">
      {/* The badges sit on the photo but outside the link, so the link's name is the hotel's name and place only. */}
      <span className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
        <Badge tone={statusTone(hotel.status)} dot className="shadow-sm">{HOTEL_STATUS_LABELS[hotel.status]}</Badge>
        {hotel.dataSource === 'DEMO' && <DemoBadge />}
      </span>
      <Link to={`/hotel-manager/hotels/${hotel.id}/dashboard`} className="block rounded-t-2xl">
        <div className="relative aspect-[16/9] overflow-hidden bg-role-50">
          {hotel.imageUrl
            ? <img src={hotel.imageUrl} alt="" className="size-full object-cover transition-transform duration-(--duration-slower) ease-out-soft group-hover:scale-105" loading="lazy" />
            : <HotelIllustration className="mx-auto h-full w-auto p-4" />}
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-950/40 to-transparent" />
        </div>
        <div className="flex flex-col gap-1 px-4 pt-4">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 group-hover:text-role-700">{hotel.name}</h2>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 text-role-600" aria-hidden="true" />{hotel.city}</span>
            <span aria-hidden="true">·</span>
            <span>{hotel.roomTypes} room type{hotel.roomTypes === 1 ? '' : 's'} on sale</span>
          </p>
        </div>
      </Link>
      <HotelFigures hotel={hotel} />
    </Card>
  );
}

/** Tonight, today and the last 30 days of one hotel (its dashboard call, at most two at a time). */
function HotelFigures({ hotel }: { hotel: HotelSummary }) {
  const dashboard = usePortfolioDashboard(hotel.id);
  const data = dashboard.data;
  if (dashboard.isError) {
    return <p className="mt-auto px-4 pb-4 pt-3 text-sm text-slate-600">Figures unavailable: {ApiError.from(dashboard.error).message}</p>;
  }
  const revenueChange = data ? toStatChange(data.comparison.revenue, { period: '' }) : undefined;
  return (
    <div className="mt-auto border-t border-slate-100 px-4 pb-4 pt-3" aria-busy={!data || undefined}>
      {!data && <span role="status" className="sr-only">Loading the figures of {hotel.name}…</span>}
      <dl className="grid grid-cols-3 gap-2">
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-slate-600">Occupancy tonight</dt>
          <dd className="mt-0.5 text-lg font-bold text-slate-900">{data ? formatPercent(data.today.occupancyPercent) : <Skeleton className="h-6 w-12" />}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-slate-600">Arrivals today</dt>
          <dd className="mt-0.5 text-lg font-bold text-slate-900">{data ? formatCount(data.today.arrivals) : <Skeleton className="h-6 w-10" />}</dd>
          {data && <dd className="text-xs text-slate-500">{formatCount(data.today.arrivingGuests)} guest{data.today.arrivingGuests === 1 ? '' : 's'}</dd>}
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-slate-600">Revenue, 30 days</dt>
          <dd className="mt-0.5 truncate text-lg font-bold text-slate-900">{data ? formatINR(data.stats.revenue) : <Skeleton className="h-6 w-16" />}</dd>
          {revenueChange && <dd><TrendChip change={revenueChange} /></dd>}
        </div>
      </dl>
    </div>
  );
}
