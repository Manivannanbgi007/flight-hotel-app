import { Link } from 'react-router';
import { BedDouble, Coffee, Hotel, MapPin, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { DemoBadge, GuestRating, StarRating } from './HotelBadges';
import { stayParams } from './searchParams';
import { PROPERTY_TYPE_LABELS, type HotelCard, type Stay } from './types';

/** One hotel in the results: photo, name, rating, amenities, perks and the price for the stay. */
export function HotelResultCard({ hotel, stay, nights, distanceFrom, amenityNames }: {
  hotel: HotelCard;
  stay: Stay;
  nights: number;
  distanceFrom: string | null;
  amenityNames: Map<string, string>;
}) {
  const href = `/hotels/${hotel.slug}?${stayParams(stay).toString()}`;
  return (
    <Card interactive className="group grid overflow-hidden sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <Link to={href} className="relative block aspect-[16/10] overflow-hidden bg-gradient-sky sm:aspect-auto sm:min-h-52" tabIndex={-1} aria-hidden="true">
        {hotel.imageUrl ? (
          <img src={hotel.imageUrl} alt="" loading="lazy"
            className={cn('size-full object-cover object-left transition-transform duration-(--duration-slow) ease-out-soft group-hover:scale-105', !hotel.available && 'grayscale-[40%]')} />
        ) : (
          <span className="flex size-full items-center justify-center text-brand-300">
            <Hotel className="size-12" />
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-950/30 to-transparent" />
        {hotel.demo && <DemoBadge className="absolute left-3 top-3 shadow-sm" />}
      </Link>

      <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-5 md:flex-row md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
            <span className="rounded-full bg-slate-100 px-2 py-0.5">{PROPERTY_TYPE_LABELS[hotel.propertyType]}</span>
            <StarRating stars={hotel.starRating} />
          </div>
          <h2 className="text-lg font-bold leading-snug text-slate-900">
            <Link to={href} className="rounded-sm transition-colors hover:text-brand-700 hover:underline">
              {hotel.name}
            </Link>
          </h2>
          <p className="flex items-start gap-1.5 text-sm text-slate-600">
            <MapPin className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
            <span className="min-w-0">
              {hotel.addressLine}, {hotel.city}
              {hotel.distanceKm !== null && distanceFrom && (
                <span className="text-slate-600"> · {hotel.distanceKm} km from {distanceFrom}</span>
              )}
            </span>
          </p>
          <GuestRating rating={hotel.guestRating} reviews={hotel.reviewCount} />
          {hotel.amenities.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Amenities">
              {hotel.amenities.slice(0, 4).map((code) => (
                <li key={code}>
                  <Badge>{amenityNames.get(code) ?? code}</Badge>
                </li>
              ))}
              {hotel.amenities.length > 4 && <li className="self-center text-xs font-medium text-slate-600">+{hotel.amenities.length - 4} more</li>}
            </ul>
          )}
          {(hotel.freeCancellation || hotel.breakfastIncluded) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
              {hotel.freeCancellation && (
                <span className="inline-flex items-center gap-1 text-success-700">
                  <ShieldCheck className="size-4" aria-hidden="true" /> Free cancellation
                </span>
              )}
              {hotel.breakfastIncluded && (
                <span className="inline-flex items-center gap-1 text-success-700">
                  <Coffee className="size-4" aria-hidden="true" /> Breakfast available
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-start gap-1 border-t border-slate-100 pt-4 md:min-w-44 md:items-end md:border-l md:border-t-0 md:pl-5 md:pt-0 md:text-right">
          {hotel.available && hotel.pricePerNight !== null ? (
            <>
              {hotel.cheapestRoomType && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                  <BedDouble className="size-3.5" aria-hidden="true" /> {hotel.cheapestRoomType}
                </span>
              )}
              <p className="text-2xl font-bold tracking-tight text-slate-900">
                {formatMoney(hotel.pricePerNight, hotel.currency)}
                <span className="text-sm font-medium text-slate-600"> / night</span>
              </p>
              <p className="text-xs text-slate-600">
                {formatMoney(hotel.totalPrice, hotel.currency)} for {nights} night{nights === 1 ? '' : 's'}
                {stay.rooms > 1 ? `, ${stay.rooms} rooms` : ''} incl. taxes
              </p>
              {hotel.availableRoomTypes > 1 && (
                <p className="text-xs font-medium text-success-700">{hotel.availableRoomTypes} room types available</p>
              )}
              <ButtonLink to={href} className="mt-auto w-full md:mt-3">
                See rooms
              </ButtonLink>
            </>
          ) : (
            <>
              <Badge tone="danger">Not available for your dates</Badge>
              <ButtonLink to={href} variant="secondary" size="sm" className="mt-2">
                View hotel
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

/** The loading placeholder in the shape of a result card. */
export function HotelResultCardSkeleton() {
  return (
    <div className="grid overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card sm:grid-cols-[15rem_1fr]">
      <Skeleton className="aspect-[16/10] rounded-none sm:aspect-auto sm:min-h-52" />
      <div className="flex flex-col gap-3 p-5 md:flex-row md:justify-between">
        <div className="flex flex-1 flex-col gap-2.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3.5 w-40" />
          <div className="flex gap-1.5"><Skeleton className="h-5 w-16 rounded-full" /><Skeleton className="h-5 w-20 rounded-full" /></div>
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-36" />
          <Skeleton className="mt-2 h-10 w-full md:w-36" />
        </div>
      </div>
    </div>
  );
}
