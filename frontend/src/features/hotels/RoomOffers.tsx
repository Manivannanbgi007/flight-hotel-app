import type { UseQueryResult } from '@tanstack/react-query';
import { BedDouble, Coffee, Maximize2, ShieldCheck, ShieldOff, Sparkles, Users } from 'lucide-react';

import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { RoomOffer, RoomsResponse } from './types';

type Choice = { roomTypeId: string; ratePlanId: string };

/** Room selection: every room type with its plans, prices for the whole stay (taxes shown) and a Reserve button. */
export function RoomOffers({ rooms, reserving, reserveError, onReserve }: {
  rooms: UseQueryResult<RoomsResponse>;
  reserving: Choice | undefined;
  reserveError: ApiError | null;
  onReserve: (choice: Choice) => void;
}) {
  if (rooms.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <span role="status" className="sr-only">Loading rooms and prices…</span>
        {[0, 1].map((i) => (
          <div key={i} className="grid overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card md:grid-cols-[17rem_1fr]">
            <div className="flex flex-col gap-2.5 bg-slate-50 p-5">
              <Skeleton className="aspect-[3/2] w-full rounded-xl" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3.5 w-1/2" />
            </div>
            <div className="flex flex-col gap-3 p-5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="ml-auto h-10 w-32" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (rooms.isError) {
    const error = ApiError.from(rooms.error);
    return <ErrorState title="Prices could not be loaded" description={error.message} onRetry={() => void rooms.refetch()} />;
  }
  const data = rooms.data;
  if (data.roomTypes.length === 0) {
    return <EmptyState illustration="search" title="No rooms on sale" description="This hotel has no rooms for sale at the moment." />;
  }
  return (
    <div className="flex flex-col gap-5">
      {reserveError && (
        <Alert tone="danger" title="This room could not be reserved">
          {reserveError.message} {reserveError.code === 'ROOMS_NOT_AVAILABLE' && 'Prices and availability below were refreshed.'}
        </Alert>
      )}
      {data.roomTypes.map((offer) => (
        <RoomCard key={offer.roomType.id} offer={offer} nights={data.nights} rooms={data.rooms}
          reserving={reserving} onReserve={onReserve} />
      ))}
    </div>
  );
}

function RoomCard({ offer, nights, rooms, reserving, onReserve }: {
  offer: RoomOffer;
  nights: number;
  rooms: number;
  reserving: Choice | undefined;
  onReserve: (choice: Choice) => void;
}) {
  const room = offer.roomType;
  const image = room.images[0];
  return (
    <Card className="grid overflow-hidden md:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/80 p-5 md:border-b-0 md:border-r">
        {image ? (
          <img src={image.thumbUrl} alt="" className="aspect-[3/2] w-full rounded-xl object-cover shadow-xs" loading="lazy" />
        ) : (
          <div aria-hidden="true" className="flex aspect-[3/2] w-full items-center justify-center rounded-xl bg-gradient-sky text-brand-300 ring-1 ring-brand-100">
            <BedDouble className="size-10" />
          </div>
        )}
        <h3 className="text-lg font-bold leading-snug text-slate-900">{room.name}</h3>
        <ul className="flex flex-col gap-1.5 text-sm text-slate-700">
          <li className="flex items-center gap-2"><BedDouble className="size-4 shrink-0 text-brand-600" aria-hidden="true" /> {room.bedConfiguration}</li>
          <li className="flex items-center gap-2"><Users className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
            Up to {room.maxAdults} adult{room.maxAdults === 1 ? '' : 's'}{room.maxChildren > 0 ? ` + ${room.maxChildren} child${room.maxChildren === 1 ? '' : 'ren'}` : ''}
          </li>
          {room.sizeSqm && <li className="flex items-center gap-2"><Maximize2 className="size-4 shrink-0 text-brand-600" aria-hidden="true" /> {room.sizeSqm} m²</li>}
        </ul>
        {room.description && <p className="text-sm leading-relaxed text-slate-600">{room.description}</p>}
        {room.amenities.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {room.amenities.map((a) => <li key={a.code}><Badge>{a.name}</Badge></li>)}
          </ul>
        )}
      </div>

      <div className="flex min-w-0 flex-col divide-y divide-slate-100">
        {!offer.available && (
          <div className="px-5 py-3">
            <Badge tone="danger" dot>
              {!offer.fitsParty ? `Does not fit your party in ${rooms} room${rooms === 1 ? '' : 's'}` : 'Sold out for your dates'}
            </Badge>
          </div>
        )}
        {offer.rates.map((rate) => {
          const busy = reserving?.ratePlanId === rate.ratePlanId;
          const seasons = [...new Set(rate.nights.map((n) => n.season).filter(Boolean))];
          return (
            <div key={rate.ratePlanId} className="flex flex-col gap-4 p-5 transition-colors duration-(--duration-fast) hover:bg-brand-50/30 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1.5 text-sm">
                <p className="text-base font-bold text-slate-900">{rate.name}</p>
                <p className={cn('flex items-center gap-1.5', rate.breakfastIncluded ? 'font-medium text-success-700' : 'text-slate-600')}>
                  <Coffee className="size-4 shrink-0" aria-hidden="true" /> {rate.breakfastIncluded ? 'Breakfast included' : 'Room only'}
                </p>
                <p className={cn('flex items-start gap-1.5', rate.freeCancellation ? 'font-medium text-success-700' : 'text-slate-600')}>
                  {rate.freeCancellation
                    ? <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    : <ShieldOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                  {rate.cancellationPolicy}
                </p>
                {seasons.length > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Sparkles className="size-3.5 shrink-0 text-accent-600" aria-hidden="true" />
                    <span>Includes seasonal prices ({seasons.join(', ')})</span>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end sm:text-right">
                <p className="text-2xl font-bold tracking-tight text-slate-900">
                  {formatMoney(rate.pricePerNight, rate.currency)}<span className="text-sm font-medium text-slate-600"> / night</span>
                </p>
                <p className="text-xs text-slate-600">
                  {formatMoney(rate.subtotal, rate.currency)} + {formatMoney(rate.taxes, rate.currency)} taxes ={' '}
                  <strong className="text-slate-900">{formatMoney(rate.total, rate.currency)}</strong>
                </p>
                <p className="text-xs text-slate-600">{nights} night{nights === 1 ? '' : 's'}, {rooms} room{rooms === 1 ? '' : 's'}</p>
                <Button
                  className="mt-2 w-full sm:w-auto sm:min-w-32"
                  disabled={!offer.available || (reserving !== undefined && !busy)}
                  loading={busy}
                  onClick={() => onReserve({ roomTypeId: room.id, ratePlanId: rate.ratePlanId })}
                  aria-label={`Reserve ${room.name}, ${rate.name}`}
                >
                  Reserve
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
