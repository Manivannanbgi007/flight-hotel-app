import { useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import {
  Ban, BedDouble, CalendarRange, Coffee, DoorOpen, IndianRupee, Pencil, Plus, ShieldCheck, Tags, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { ChartCard, DonutChart, formatCount, formatINR } from '@/components/charts';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DateField } from '@/components/ui/DateField';
import { SelectField, TextField } from '@/components/ui/Field';
import { checkboxClass, controlClass } from '@/components/ui/fieldStyles';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { todayIso } from '@/features/account/schemas';
import { hotelApi } from '@/features/hotels/hotelApi';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney } from '@/lib/format';
import { FactChip, ManagerPageHeader, MetricGrid, MetricTile } from './ManagerParts';
import { managerApi } from './managerApi';
import {
  formToRatePlanRequest,
  formToRoomTypeRequest,
  ratePlanSchema,
  ratePlanToForm,
  roomTypeSchema,
  roomTypeToForm,
  seasonalRateSchema,
  type RatePlanForm,
  type RoomTypeForm,
  type SeasonalRateForm,
} from './schemas';
import type { RatePlanItem, RoomTypeItem } from './types';

/** A checkbox drawn as a pill: the whole pill is the label, tinted in the portal colour while it is checked. */
const choicePill = cn(
  'inline-flex cursor-pointer select-none items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-2.5 pr-3.5',
  'text-sm font-medium text-slate-700 transition-colors duration-(--duration-fast) hover:border-slate-300',
  'has-[:checked]:border-role-300 has-[:checked]:bg-role-50 has-[:checked]:text-role-800',
);

/** The small caption above a group of form fields. */
const legendClass = 'mb-3 text-xs font-bold uppercase tracking-wider text-slate-500';

/** Room management and room pricing (base prices, plans, seasonal prices). */
export function RoomsRatesPage() {
  const { hotelId = '' } = useParams();
  const [adding, setAdding] = useState(false);
  const rooms = useQuery({ queryKey: queryKeys.hotelManager.roomTypes(hotelId), queryFn: () => managerApi.roomTypes(hotelId) });
  const amenities = useQuery({ queryKey: queryKeys.hotels.amenities, queryFn: hotelApi.amenities, staleTime: Infinity });

  if (rooms.isPending) return <LoadingState label="Loading the rooms and rates…" />;
  if (rooms.isError) return <ErrorState description={ApiError.from(rooms.error).message} onRetry={() => void rooms.refetch()} />;

  const amenityNames = new Map((amenities.data ?? []).map((amenity) => [amenity.code, amenity.name]));
  return (
    <div className="flex flex-col gap-5">
      <ManagerPageHeader
        icon={<BedDouble className="size-5" />}
        title="Rooms & rates"
        description="A room type is sold through its rate plans. Seasonal prices replace the base price on the nights they cover."
        actions={!adding && <Button variant="role" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" /> Add room type</Button>}
      />
      {adding && (
        <section aria-labelledby="new-room-type"
          className="rounded-2xl border border-role-200 bg-[linear-gradient(180deg,var(--role-50),white_45%)] p-5 shadow-card animate-fade-up sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-role-50 text-role-600 ring-1 ring-inset ring-role-100">
              <Plus className="size-5" />
            </span>
            <div>
              <h3 id="new-room-type" className="text-base font-bold text-slate-900">New room type</h3>
              <p className="text-sm text-slate-500">Its rooms go on sale for the next 365 days. Add a rate plan next, so guests can book it.</p>
            </div>
          </div>
          <RoomTypeEditor hotelId={hotelId} onDone={() => setAdding(false)} />
        </section>
      )}
      {rooms.data.length > 0 && <RoomSummary rooms={rooms.data} />}
      {rooms.data.length === 0 && !adding && (
        <EmptyState title="No room types yet" description="Add the kinds of rooms you sell, for example 'Deluxe King'." />
      )}
      {rooms.data.map((room) => <RoomTypeCard key={room.id} hotelId={hotelId} room={room} amenityNames={amenityNames} />)}
    </div>
  );
}

/** Rooms and prices at a glance: what is on sale, how many rooms, how many plans, and how the rooms split by type. */
function RoomSummary({ rooms }: { rooms: RoomTypeItem[] }) {
  const onSale = rooms.filter((room) => room.status === 'ACTIVE');
  const plans = rooms.flatMap((room) => room.ratePlans).filter((plan) => plan.status === 'ACTIVE');
  const prices = plans.map((plan) => plan.basePricePerNight);
  const totalRooms = onSale.reduce((sum, room) => sum + room.totalRooms, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <MetricGrid label="Room figures" columns={2}>
        <MetricTile label="Room types on sale" value={onSale.length} format={formatCount} icon={<BedDouble />}
          hint={`${formatCount(rooms.length)} in all`} />
        <MetricTile label="Rooms on sale" value={totalRooms} format={formatCount} icon={<DoorOpen />}
          hint="Rooms per night, all room types" />
        <MetricTile label="Active rate plans" value={plans.length} format={formatCount} icon={<Tags />}
          hint={`${formatCount(plans.filter((plan) => plan.breakfastIncluded).length)} with breakfast`} />
        <MetricTile label="Lowest price per night" value={prices.length ? Math.min(...prices) : 0}
          format={(value) => (prices.length ? formatINR(value) : '—')} icon={<IndianRupee />}
          hint={prices.length ? `Up to ${formatINR(Math.max(...prices))}, base prices` : 'No active rate plan yet'} />
      </MetricGrid>
      <ChartCard as="h3" title="Rooms by room type" description="Rooms per night of the room types on sale">
        <DonutChart title="Rooms by room type" valueFormat="count" centerLabel="Rooms" height={170} emptyMessage="No room types on sale"
          data={onSale.map((room) => ({ label: room.name, value: room.totalRooms }))} />
      </ChartCard>
    </div>
  );
}

function useInvalidateRooms(hotelId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.hotelManager.roomTypes(hotelId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.hotelManager.inventory(hotelId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.hotelManager.hotels });
  };
}

/** One room type: its facts and amenities, its editor, and its rate plans as cards. */
function RoomTypeCard({ hotelId, room, amenityNames }: { hotelId: string; room: RoomTypeItem; amenityNames: Map<string, string> }) {
  const [editing, setEditing] = useState(false);
  const [addingPlan, setAddingPlan] = useState(false);
  const onSale = room.status === 'ACTIVE';
  const activePrices = room.ratePlans.filter((plan) => plan.status === 'ACTIVE').map((plan) => plan.basePricePerNight);
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        {/* At least ~18rem for the name and facts: on phones the price and "Edit" wrap below instead of squeezing them. */}
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-4">
          <span aria-hidden="true" className="hidden size-12 shrink-0 items-center justify-center rounded-2xl bg-role-50 text-role-600 ring-1 ring-inset ring-role-100 sm:flex">
            <BedDouble className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-slate-900">{room.name}</h2>
              <Badge tone={onSale ? 'success' : 'neutral'} dot>{onSale ? 'On sale' : 'Not on sale'}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-slate-600">
              {room.bedConfiguration} · up to {room.maxAdults} adults + {room.maxChildren} children
              {room.sizeSqm ? ` · ${room.sizeSqm} m²` : ''} · {room.totalRooms} rooms per night
            </p>
            {room.description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{room.description}</p>}
            {room.amenities.length > 0 && (
              <ul aria-label={`Amenities of ${room.name}`} className="mt-3 flex flex-wrap gap-1.5">
                {room.amenities.map((code) => <li key={code}><FactChip>{amenityNames.get(code) ?? code}</FactChip></li>)}
              </ul>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {activePrices.length > 0 && (
            <p className="text-right text-xs text-slate-500">
              <span className="block">From</span>{' '}
              <span className="block text-lg font-bold leading-tight tracking-tight text-slate-900">{formatINR(Math.min(...activePrices))}</span>{' '}
              <span className="block">per night</span>
            </p>
          )}
          {!editing && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden="true" /> Edit room type
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <div className="border-t border-slate-100 bg-slate-50/80 p-5">
          <RoomTypeEditor hotelId={hotelId} room={room} onDone={() => setEditing(false)} />
        </div>
      )}
      <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Rate plans</h3>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold tabular-nums text-slate-600 ring-1 ring-inset ring-slate-200">
              {room.ratePlans.length}
            </span>
          </div>
          {!addingPlan && (
            <Button variant="secondary" size="sm" onClick={() => setAddingPlan(true)}><Plus className="size-4" aria-hidden="true" /> Add rate plan</Button>
          )}
        </div>
        {addingPlan && (
          <div className="rounded-2xl border border-role-200 bg-white p-4 shadow-xs animate-fade-up">
            <p className="mb-3 text-sm font-semibold text-slate-900">New rate plan</p>
            <RatePlanEditor hotelId={hotelId} roomTypeId={room.id} onDone={() => setAddingPlan(false)} />
          </div>
        )}
        {room.ratePlans.length === 0 && !addingPlan && (
          <Alert tone="warning">No rate plans: this room type cannot be booked until you add one.</Alert>
        )}
        {room.ratePlans.length > 0 && (
          <ul aria-label={`Rate plans of ${room.name}`} className="grid gap-4 md:grid-cols-2">
            {room.ratePlans.map((plan) => <RatePlanCard key={plan.id} hotelId={hotelId} roomTypeId={room.id} plan={plan} />)}
          </ul>
        )}
      </div>
    </article>
  );
}

function RoomTypeEditor({ hotelId, room, onDone }: { hotelId: string; room?: RoomTypeItem; onDone: () => void }) {
  const invalidate = useInvalidateRooms(hotelId);
  const amenities = useQuery({ queryKey: queryKeys.hotels.amenities, queryFn: hotelApi.amenities, staleTime: Infinity });
  const { register, handleSubmit, setError, formState: { errors } } = useForm<RoomTypeForm>({
    resolver: zodResolver(roomTypeSchema), defaultValues: roomTypeToForm(room),
  });
  const save = useMutation({
    mutationFn: (form: RoomTypeForm) => (room
      ? managerApi.updateRoomType(hotelId, room.id, formToRoomTypeRequest(form, room))
      : managerApi.createRoomType(hotelId, formToRoomTypeRequest(form))),
    onSuccess: () => {
      invalidate();
      toast.success(room ? 'Room type saved.' : 'Room type added. Its rooms are on sale for the next 365 days.');
      onDone();
    },
    onError: (error) => applyServerErrors(error, setError, ['name', 'maxAdults', 'maxChildren', 'bedConfiguration', 'sizeSqm', 'totalRooms']),
  });
  const error = save.error ? ApiError.from(save.error) : null;
  const roomAmenities = (amenities.data ?? []).filter((a) => a.category === 'ROOM');
  const descriptionId = `desc-${room?.id ?? 'new'}`;

  return (
    <form onSubmit={handleSubmit((form) => save.mutate(form))} noValidate className="flex flex-col gap-6">
      {error?.code === 'INVENTORY_BELOW_RESERVED' && (
        <Alert tone="danger" title="Not enough rooms">
          Some nights already have more rooms booked or held: {(error.details.nights as string[] | undefined)?.slice(0, 5).map(formatDate).join(', ')}.
          Lower the rooms on other nights in the inventory calendar instead.
        </Alert>
      )}
      {error && !['VALIDATION_FAILED', 'INVENTORY_BELOW_RESERVED'].includes(error.code) && <Alert tone="danger">{error.message}</Alert>}
      <fieldset>
        <legend className={legendClass}>The room</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="Name" error={errors.name?.message} {...register('name')} />
          <TextField label="Beds" placeholder="1 King bed" error={errors.bedConfiguration?.message} {...register('bedConfiguration')} />
          <TextField label="Size (m²)" optional inputMode="numeric" error={errors.sizeSqm?.message} {...register('sizeSqm')} />
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
            <label htmlFor={descriptionId} className="text-sm font-semibold text-slate-800">
              Description <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <textarea id={descriptionId} rows={2} placeholder="What makes this room special: the view, the space, the bathroom…"
              className={controlClass(false)} {...register('description')} />
          </div>
        </div>
      </fieldset>
      <fieldset>
        <legend className={legendClass}>Guests and sale</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="Max adults" inputMode="numeric" error={errors.maxAdults?.message} {...register('maxAdults')} />
          <TextField label="Max children" inputMode="numeric" error={errors.maxChildren?.message} {...register('maxChildren')} />
          <TextField label="Rooms for sale per night" inputMode="numeric" error={errors.totalRooms?.message}
            hint={room ? 'Applies to all future nights' : undefined} {...register('totalRooms')} />
          <SelectField label="Status" {...register('status')}>
            <option value="ACTIVE">On sale</option>
            <option value="INACTIVE">Not on sale</option>
          </SelectField>
        </div>
      </fieldset>
      <fieldset>
        <legend className={legendClass}>Room amenities</legend>
        <div className="flex flex-wrap gap-2">
          {roomAmenities.map((a) => (
            <label key={a.code} className={choicePill}>
              <input type="checkbox" value={a.code} className={checkboxClass} {...register('amenities')} />
              {a.name}
            </label>
          ))}
        </div>
      </fieldset>
      <FormButtons>
        <Button type="submit" loading={save.isPending}>{room ? 'Save room type' : 'Add room type'}</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </FormButtons>
    </form>
  );
}

function FormButtons({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 border-t border-slate-200/70 pt-4">{children}</div>;
}

/** One rate plan: name, price per night, breakfast and cancellation terms, its editor and its seasonal prices. */
function RatePlanCard({ hotelId, roomTypeId, plan }: { hotelId: string; roomTypeId: string; plan: RatePlanItem }) {
  const [editing, setEditing] = useState(false);
  const [addingSeason, setAddingSeason] = useState(false);
  const onSale = plan.status === 'ACTIVE';
  return (
    <li className={cn('flex min-w-0 flex-col rounded-2xl border bg-white shadow-xs transition-shadow hover:shadow-md',
      onSale ? 'border-slate-200' : 'border-dashed border-slate-300', (editing || addingSeason) && 'md:col-span-2')}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{plan.name}</p>
            {!onSale && <Badge>Not on sale</Badge>}
          </div>
          {!editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden="true" /> Edit
            </Button>
          )}
        </div>
        <p className="flex items-baseline gap-1">
          <span className={cn('text-2xl font-bold tracking-tight tabular-nums', onSale ? 'text-slate-900' : 'text-slate-500')}>
            {formatMoney(plan.basePricePerNight, plan.currency)}
          </span>{' '}
          <span className="text-sm text-slate-500">/ night</span>
        </p>
        <div className="flex flex-col gap-2">
          <span>
            {plan.breakfastIncluded
              ? <Badge tone="accent"><Coffee className="size-3.5" aria-hidden="true" />Breakfast included</Badge>
              : <Badge><BedDouble className="size-3.5" aria-hidden="true" />Room only</Badge>}
          </span>
          <p className="flex items-start gap-1.5 text-sm text-slate-600">
            {plan.refundable
              ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden="true" />
              : <Ban className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden="true" />}
            <span>{plan.cancellationSummary}</span>
          </p>
        </div>
      </div>
      {editing && (
        <div className="border-t border-slate-100 p-4">
          <RatePlanEditor hotelId={hotelId} roomTypeId={roomTypeId} plan={plan} onDone={() => setEditing(false)} />
        </div>
      )}
      <SeasonalRates hotelId={hotelId} roomTypeId={roomTypeId} plan={plan} adding={addingSeason} setAdding={setAddingSeason} />
    </li>
  );
}

function RatePlanEditor({ hotelId, roomTypeId, plan, onDone }: { hotelId: string; roomTypeId: string; plan?: RatePlanItem; onDone: () => void }) {
  const invalidate = useInvalidateRooms(hotelId);
  const { register, handleSubmit, control, setError, formState: { errors } } = useForm<RatePlanForm>({
    resolver: zodResolver(ratePlanSchema), defaultValues: ratePlanToForm(plan),
  });
  const refundable = useWatch({ control, name: 'refundable' });
  const save = useMutation({
    mutationFn: (form: RatePlanForm) => (plan
      ? managerApi.updateRatePlan(hotelId, roomTypeId, plan.id, formToRatePlanRequest(form, plan))
      : managerApi.createRatePlan(hotelId, roomTypeId, formToRatePlanRequest(form))),
    onSuccess: () => {
      invalidate();
      toast.success(plan ? 'Rate plan saved.' : 'Rate plan added.');
      onDone();
    },
    onError: (error) => applyServerErrors(error, setError, ['name', 'basePricePerNight', 'freeCancellationHours', 'cancellationFeePercent']),
  });
  const error = save.error ? ApiError.from(save.error) : null;
  return (
    <form onSubmit={handleSubmit((form) => save.mutate(form))} noValidate className="flex flex-col gap-4">
      {error && error.code !== 'VALIDATION_FAILED' && <Alert tone="danger">{error.message}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Plan name" placeholder="Room only" error={errors.name?.message} {...register('name')} />
        <TextField label="Base price per night (₹)" inputMode="decimal" error={errors.basePricePerNight?.message} {...register('basePricePerNight')} />
        <SelectField label="Status" {...register('status')}>
          <option value="ACTIVE">On sale</option>
          <option value="INACTIVE">Not on sale</option>
        </SelectField>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className={choicePill}>
          <input type="checkbox" className={checkboxClass} {...register('breakfastIncluded')} />
          Breakfast included
        </label>
        <label className={choicePill}>
          <input type="checkbox" className={checkboxClass} {...register('refundable')} />
          Refundable
        </label>
      </div>
      {refundable && (
        <div className="grid gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200/70 sm:grid-cols-2">
          <TextField label="Free cancellation until (hours before check-in)" inputMode="numeric" optional
            hint="48 = free until two days before check-in" error={errors.freeCancellationHours?.message} {...register('freeCancellationHours')} />
          <TextField label="Fee after that (% of total)" inputMode="decimal" optional error={errors.cancellationFeePercent?.message}
            {...register('cancellationFeePercent')} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={save.isPending}>{plan ? 'Save plan' : 'Add plan'}</Button>
        <Button variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function SeasonalRates({ hotelId, roomTypeId, plan, adding, setAdding }: {
  hotelId: string;
  roomTypeId: string;
  plan: RatePlanItem;
  adding: boolean;
  setAdding: (adding: boolean) => void;
}) {
  const invalidate = useInvalidateRooms(hotelId);
  const { register, handleSubmit, control, reset, setError, formState: { errors } } = useForm<SeasonalRateForm>({
    resolver: zodResolver(seasonalRateSchema),
    defaultValues: { label: '', startDate: '', endDate: '', pricePerNight: '', priority: '0' },
  });
  const [startDate, endDate] = useWatch({ control, name: ['startDate', 'endDate'] });
  const add = useMutation({
    mutationFn: (form: SeasonalRateForm) => managerApi.addSeasonalRate(hotelId, roomTypeId, plan.id, {
      label: form.label.trim(), startDate: form.startDate, endDate: form.endDate, pricePerNight: Number(form.pricePerNight),
      priority: Number(form.priority),
    }),
    onSuccess: () => {
      invalidate();
      reset();
      setAdding(false);
      toast.success('Seasonal price added.');
    },
    onError: (error) => applyServerErrors(error, setError, ['label', 'startDate', 'endDate', 'pricePerNight']),
  });
  const remove = useMutation({
    mutationFn: (rateId: string) => managerApi.deleteSeasonalRate(hotelId, roomTypeId, plan.id, rateId),
    onSuccess: invalidate,
  });
  const error = add.error ? ApiError.from(add.error) : null;

  return (
    <div className="mt-auto flex flex-col gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
          <CalendarRange className="size-3.5" aria-hidden="true" /> Seasonal prices
        </span>
        {!adding && <Button variant="ghost" size="sm" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" /> Add</Button>}
      </div>
      {plan.seasonalRates.length === 0 && !adding && <p className="text-slate-500">None: the base price applies every night.</p>}
      {plan.seasonalRates.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {plan.seasonalRates.map((rate) => (
            <li key={rate.id} className="flex items-center gap-3 rounded-xl bg-white py-2 pl-3 pr-1.5 ring-1 ring-inset ring-slate-200/80">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{rate.label}</p>
                <p className="text-xs text-slate-500">
                  {formatDate(rate.startDate)} – {formatDate(rate.endDate)}{rate.priority > 0 ? ` · priority ${rate.priority}` : ''}
                </p>
              </div>
              <p className="whitespace-nowrap text-right font-semibold tabular-nums text-slate-900">
                {formatMoney(rate.pricePerNight)} <span className="text-xs font-normal text-slate-500">/ night</span>
              </p>
              <Button variant="ghost" size="sm" aria-label={`Delete seasonal price ${rate.label}`} loading={remove.isPending && remove.variables === rate.id}
                onClick={() => remove.mutate(rate.id)}>
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form onSubmit={handleSubmit((form) => add.mutate(form))} noValidate
          className="mt-1 flex flex-col gap-3 rounded-xl bg-white p-3 ring-1 ring-inset ring-role-200">
          {error && error.code !== 'VALIDATION_FAILED' && <Alert tone="danger">{error.message}</Alert>}
          {/* Columns of at least ~200 px, so a date ("Wed, 30 Sep 2026") fits; the two nights stay side by side. */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            <div className="sm:col-span-2 xl:col-span-1">
              <TextField label="Season" placeholder="Diwali week" error={errors.label?.message} {...register('label')} />
            </div>
            <Controller control={control} name="startDate" render={({ field }) => (
              <DateField label="First night" min={todayIso()} error={errors.startDate?.message} rangeEnd={endDate} {...field} />
            )} />
            <Controller control={control} name="endDate" render={({ field }) => (
              <DateField label="Last night" min={todayIso()} error={errors.endDate?.message} rangeStart={startDate} {...field} />
            )} />
            <TextField label="Price per night (₹)" inputMode="decimal" error={errors.pricePerNight?.message} {...register('pricePerNight')} />
            <TextField label="Priority" inputMode="numeric" hint="Higher wins on overlap" error={errors.priority?.message} {...register('priority')} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={add.isPending}>Add seasonal price</Button>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
