import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, CalendarDays, Check, Clock, ExternalLink, Info, MapPin, Navigation, Users } from 'lucide-react';

import { HotelIllustration } from '@/components/illustrations';
import { PageContainer } from '@/components/layout/PageContainer';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { buttonClass } from '@/components/ui/buttonStyles';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/StateViews';
import { HotelReviews } from '@/features/reviews/HotelReviews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { formatShortDate } from '@/lib/format';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { DemoBadge, GuestRating, StarRating } from './HotelBadges';
import { hotelApi } from './hotelApi';
import { HotelSearchForm } from './HotelSearchForm';
import { RoomOffers } from './RoomOffers';
import { describeGuests, parseStay, stayParams } from './searchParams';
import { PROPERTY_TYPE_LABELS, type HotelDetails, type HotelImage, type Stay } from './types';

const POLICY_LABELS: Record<string, string> = {
  CHILDREN: 'Children', PETS: 'Pets', SMOKING: 'Smoking', ID_REQUIRED: 'ID at check-in', PAYMENT: 'Payment', OTHER: 'Other',
};

/** /hotels/:slug?checkIn=…: everything about the hotel, then its rooms and prices for the stay. */
export function HotelDetailsPage() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const stay = useMemo(() => parseStay(params), [params]);

  const details = useQuery({ queryKey: queryKeys.hotels.details(slug), queryFn: () => hotelApi.details(slug) });
  const hotelId = details.data?.id;
  const rooms = useQuery({
    queryKey: queryKeys.hotels.rooms(hotelId ?? '', stayParams(stay).toString()),
    queryFn: () => hotelApi.rooms(hotelId ?? '', stay),
    enabled: !!hotelId,
  });

  const reserve = useMutation({
    mutationFn: (choice: { roomTypeId: string; ratePlanId: string }) =>
      hotelApi.quote({ hotelId: hotelId ?? '', ...choice, stay }),
    onSuccess: (quote) => void navigate(`/hotels/quote/${quote.quoteId}`),
    // Sold out or price changed meanwhile: show the current situation.
    onError: () => void rooms.refetch(),
  });

  if (details.isPending) {
    return (
      <PageContainer>
        <span role="status" className="sr-only">Loading the hotel…</span>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-5 h-9 w-80 max-w-full" />
        <Skeleton className="mt-3 h-4 w-64 max-w-full" />
        <div className="mt-6 grid gap-2 md:grid-cols-[3fr_1fr]">
          <Skeleton className="aspect-[3/2] w-full rounded-3xl" />
          <div className="hidden flex-col gap-2 md:flex">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[3/2] w-full rounded-xl" />)}
          </div>
        </div>
      </PageContainer>
    );
  }
  if (details.isError) {
    const error = ApiError.from(details.error);
    if (error.status === 404) return <NotFoundPage />;
    return (
      <PageContainer width="md">
        <div className="py-6 sm:py-10">
          <ErrorState description={error.message} correlationId={error.correlationId} onRetry={() => void details.refetch()} />
        </div>
      </PageContainer>
    );
  }

  const hotel = details.data;
  const changeStay = (_destination: string, next: Stay) => setParams(stayParams(next), { replace: true });
  const resultsPath = `/hotels/search?destination=${encodeURIComponent(hotel.city)}&${stayParams(stay).toString()}`;

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: 'Hotels', to: '/hotels' }, { label: `Hotels in ${hotel.city}`, to: resultsPath }, { label: hotel.name }]}
        className="hidden sm:block" />
      <Link to={resultsPath} className="inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-brand-700 hover:underline sm:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to the results
      </Link>

      <header className="mt-4 flex flex-col gap-5 animate-fade-up lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
              {PROPERTY_TYPE_LABELS[hotel.propertyType]}
            </span>
            <StarRating stars={hotel.starRating} />
            {hotel.demo && <DemoBadge />}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-balance text-slate-900 sm:text-4xl">{hotel.name}</h1>
          <p className="flex items-start gap-1.5 text-sm text-slate-600">
            <MapPin className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
            {[hotel.addressLine, hotel.city, hotel.state, hotel.postalCode].filter(Boolean).join(', ')}
          </p>
          <a href="#reviews" className="w-fit rounded-lg hover:underline">
            <GuestRating rating={hotel.guestRating} reviews={hotel.reviewCount} />
          </a>
        </div>
        <a href="#rooms" className={buttonClass({ size: 'lg', className: 'w-full sm:w-auto' })}>
          See rooms and prices
        </a>
      </header>

      <Gallery images={hotel.images} hotelName={hotel.name} />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {hotel.description && (
            <InfoCard id="about" title="About this property">
              <p className="whitespace-pre-line leading-relaxed text-slate-700">{hotel.description}</p>
            </InfoCard>
          )}
          {hotel.amenities.length > 0 && (
            <InfoCard id="amenities" title="Amenities">
              <ul className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-3">
                {hotel.amenities.map((a) => (
                  <li key={a.code} className="flex items-center gap-2">
                    <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success-50 text-success-600 ring-1 ring-success-200">
                      <Check className="size-3" />
                    </span>
                    {a.name}
                  </li>
                ))}
              </ul>
            </InfoCard>
          )}
          <InfoCard id="rules" title="House rules">
            <div className="grid gap-3 sm:grid-cols-2">
              <TimeTile label="Check-in" value={`From ${hotel.checkInTime.slice(0, 5)}`} />
              <TimeTile label="Check-out" value={`Until ${hotel.checkOutTime.slice(0, 5)}`} />
            </div>
            {hotel.policies.length > 0 && (
              <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-[10rem_1fr]">
                {hotel.policies.map((p, i) => (
                  <div key={i} className="contents">
                    <dt className="flex items-center gap-1.5 font-semibold text-slate-800">
                      <Info className="size-4 text-slate-500" aria-hidden="true" /> {POLICY_LABELS[p.type] ?? p.type}
                    </dt>
                    <dd className="text-slate-700">{p.description}</dd>
                  </div>
                ))}
              </dl>
            )}
          </InfoCard>
          <Card className="p-5 sm:p-6">
            <HotelReviews hotelIdOrSlug={hotel.slug || hotel.id} />
          </Card>
        </div>

        <aside aria-label="Location and your stay" className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <LocationCard hotel={hotel} />
          <Card variant="tinted" className="p-5">
            <h2 className="text-base font-bold text-slate-900">Your stay</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
              <li className="flex items-center gap-2">
                <CalendarDays className="size-4 text-brand-600" aria-hidden="true" />
                {formatShortDate(stay.checkIn)} – {formatShortDate(stay.checkOut)}
              </li>
              <li className="flex items-center gap-2">
                <Users className="size-4 text-brand-600" aria-hidden="true" /> {describeGuests(stay)}
              </li>
            </ul>
            <a href="#rooms" className={buttonClass({ variant: 'secondary', className: 'mt-4 w-full' })}>Choose a room</a>
          </Card>
        </aside>
      </div>

      <section id="rooms" aria-labelledby="rooms-heading" className="mt-12 scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="rooms-heading" className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Rooms and prices</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {formatShortDate(stay.checkIn)} – {formatShortDate(stay.checkOut)} · {describeGuests(stay)}
            </p>
          </div>
        </div>
        <Card variant="elevated" className="mt-4 p-4 sm:p-5">
          <HotelSearchForm key={params.toString()} destination={hotel.city} stay={stay} onSearch={changeStay} compact
            showDestination={false} submitLabel="Update prices" />
        </Card>
        <div className="mt-5">
          <RoomOffers
            rooms={rooms}
            reserving={reserve.isPending ? reserve.variables : undefined}
            reserveError={reserve.error ? ApiError.from(reserve.error) : null}
            onReserve={(choice) => reserve.mutate(choice)}
          />
        </div>
      </section>
    </PageContainer>
  );
}

function InfoCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <section aria-labelledby={`${id}-heading`}>
        <h2 id={`${id}-heading`} className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
        <div className="mt-3">{children}</div>
      </section>
    </Card>
  );
}

function TimeTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-lg bg-white text-brand-600 shadow-xs ring-1 ring-slate-200">
        <Clock className="size-4" />
      </span>
      <dl>
        <dt className="text-xs font-semibold text-slate-600">{label}</dt>
        <dd className="text-sm font-bold text-slate-900">{value}</dd>
      </dl>
    </div>
  );
}

function Gallery({ images, hotelName }: { images: HotelImage[]; hotelName: string }) {
  const [selected, setSelected] = useState(0);
  if (images.length === 0) {
    return (
      <div aria-hidden="true" className="mt-6 flex items-center justify-center overflow-hidden rounded-3xl bg-gradient-sky py-8 ring-1 ring-brand-100">
        <div className="w-56 sm:w-64"><HotelIllustration /></div>
      </div>
    );
  }
  const main = images[Math.min(selected, images.length - 1)];
  return (
    <section aria-label="Photos" className="mt-6 grid gap-2 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
      {main && (
        <img key={main.id} src={main.url} alt={main.caption ?? hotelName}
          className="aspect-[3/2] w-full rounded-3xl bg-slate-200 object-cover shadow-md animate-fade-in" />
      )}
      <ul className="grid grid-cols-4 gap-2 md:max-h-[32rem] md:grid-cols-1 md:content-start md:overflow-y-auto md:pr-1">
        {images.map((image, index) => (
          <li key={image.id}>
            <button type="button" onClick={() => setSelected(index)} aria-label={`Show photo ${index + 1}: ${image.caption ?? ''}`}
              aria-current={index === selected}
              className={cn(
                'block w-full overflow-hidden rounded-xl ring-offset-2 transition-[box-shadow,opacity] duration-(--duration-fast)',
                index === selected ? 'ring-2 ring-brand-600' : 'opacity-80 hover:opacity-100',
              )}>
              <img src={image.thumbUrl} alt="" className="aspect-[3/2] w-full object-cover" loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LocationCard({ hotel }: { hotel: HotelDetails }) {
  const { latitude: lat, longitude: lon } = hotel;
  return (
    <Card className="overflow-hidden">
      {lat !== null && lon !== null && (
        <iframe
          title={`Map showing ${hotel.name}`}
          className="h-56 w-full border-0 bg-slate-100"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.012},${lat - 0.008},${lon + 0.012},${lat + 0.008}&layer=mapnik&marker=${lat},${lon}`}
        />
      )}
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900">Location</h2>
          {lat !== null && lon !== null && (
            <a className="inline-flex items-center gap-1 rounded-md text-sm font-semibold text-brand-700 hover:underline" target="_blank"
              rel="noreferrer noopener" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`}>
              Open larger map <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
        {hotel.nearby.length > 0 && (
          <ul className="mt-3 flex flex-col divide-y divide-slate-100 text-sm text-slate-700">
            {hotel.nearby.map((place) => (
              <li key={place.name} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Navigation className="size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                  <span className="min-w-0">{place.name}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums text-slate-600">{place.distanceKm} km</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
