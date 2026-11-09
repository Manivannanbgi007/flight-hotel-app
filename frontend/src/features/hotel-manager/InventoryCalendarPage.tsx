import { useEffect, useId, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth } from 'date-fns';
import {
  Ban, BedDouble, CalendarCheck2, CalendarDays, ChevronLeft, ChevronRight, PackageX, Percent, SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';

import { formatCount, formatPercent } from '@/components/charts';
import { ExportMenu } from '@/components/export/ExportMenu';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DateField } from '@/components/ui/DateField';
import { SelectField, TextField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { todayIso } from '@/features/account/schemas';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import type { ExportColumn } from '@/lib/export';
import { formatDate, formatMoney } from '@/lib/format';
import { FactChip, ManagerPageHeader, MetricGrid, MetricTile, Toolbar } from './ManagerParts';
import { managerApi } from './managerApi';
import { inventoryUpdateSchema, type InventoryUpdateForm } from './schemas';
import type { InventoryCalendar, InventoryDay } from './types';
import { useManagerHotels } from './useManagerHotels';

const iso = (date: Date) => format(date, 'yyyy-MM-dd');

/** One night of one room type in an export of the month. */
interface NightRow extends InventoryDay {
  roomType: string;
}

/** The columns of an export (CSV, Excel, PDF): one row per night and room type, as the calendar's cells show them. */
const EXPORT_COLUMNS: ExportColumn<NightRow>[] = [
  { header: 'Night', value: (night) => night.date, type: 'date' },
  { header: 'Room type', value: (night) => night.roomType },
  { header: 'Rooms for sale', value: (night) => night.totalRooms, type: 'integer' },
  { header: 'Booked', value: (night) => night.bookedRooms, type: 'integer' },
  { header: 'Held', value: (night) => night.heldRooms, type: 'integer' },
  { header: 'Free', value: (night) => night.freeRooms, type: 'integer' },
  { header: 'Stop-sell', value: (night) => night.stopSell },
  { header: 'Price per night', value: (night) => night.price, type: 'money' },
];

/** The month's nights, night by night and in the calendar's room type order within a night. */
function exportRows(calendar: InventoryCalendar | undefined): NightRow[] {
  if (!calendar) return [];
  // `sort` is stable: within a night the room types keep the calendar's order.
  return calendar.roomTypes
    .flatMap((room) => room.days.map((day) => ({ ...day, roomType: room.name })))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Inventory calendar: per night and room type the rooms for sale, booked, held and stop-sell, with the night's price.
 * Updates live (realtime "hotel.inventory-changed" refreshes this query).
 */
export function InventoryCalendarPage() {
  const { hotelId = '' } = useParams();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const from = iso(startOfMonth(month));
  const to = iso(endOfMonth(month));
  const calendar = useQuery({
    queryKey: [...queryKeys.hotelManager.inventory(hotelId), from, to],
    queryFn: () => managerApi.inventory(hotelId, from, to),
    placeholderData: keepPreviousData,
  });
  const [selection, setSelection] = useState<{ roomTypeId: string; date: string } | null>(null);
  const thisMonth = startOfMonth(new Date());
  const monthName = format(month, 'MMMM yyyy');
  const hotelName = useManagerHotels().data?.find((hotel) => hotel.id === hotelId)?.name;

  return (
    <div className="flex flex-col gap-5">
      <ManagerPageHeader
        icon={<CalendarDays className="size-5" />}
        title="Inventory calendar"
        description="Rooms for sale per night and room type. Choose a night to change its rooms or to stop selling it."
        actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>}
      />
      <Toolbar>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" aria-label="Previous month" disabled={month <= thisMonth}
              onClick={() => setMonth((m) => addMonths(m, -1))}>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <h3 className="min-w-40 text-center text-lg font-bold tracking-tight text-slate-900">{monthName}</h3>
            <Button variant="secondary" size="sm" aria-label="Next month" disabled={month >= addMonths(thisMonth, 11)}
              onClick={() => setMonth((m) => addMonths(m, 1))}>
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
            {month > thisMonth && (
              <Button variant="ghost" size="sm" onClick={() => setMonth(thisMonth)}>
                <CalendarCheck2 className="size-4" aria-hidden="true" /> This month
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ul aria-label="Legend" className="flex flex-wrap items-center gap-2">
              {LEGEND.map((item) => (
                <li key={item.label} className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  <span aria-hidden="true" className={cn('size-2 rounded-full', item.swatch)} />
                  {item.label}
                </li>
              ))}
            </ul>
            <ExportMenu
              title="Inventory"
              subtitle={[hotelName, monthName].filter(Boolean).join(' · ')}
              fileName={`inventory-${hotelName ?? hotelId}-${format(month, 'yyyy-MM')}`}
              columns={EXPORT_COLUMNS}
              rows={exportRows(calendar.data)}
              filters={[{ label: 'Month', value: monthName }]}
            />
          </div>
        </div>
      </Toolbar>

      {calendar.isPending && <LoadingState label="Loading the calendar…" />}
      {calendar.isError && <ErrorState description={ApiError.from(calendar.error).message} onRetry={() => void calendar.refetch()} />}
      {calendar.data && calendar.data.roomTypes.length > 0 && <MonthSummary calendar={calendar.data} month={monthName} />}
      {calendar.data && (
        <CalendarGrid calendar={calendar.data} month={month} selection={selection} onSelect={setSelection} />
      )}
      {calendar.data && calendar.data.roomTypes.length > 0 && (
        <UpdateForm key={selection ? `${selection.roomTypeId}-${selection.date}` : 'none'} hotelId={hotelId}
          calendar={calendar.data} selection={selection} />
      )}
    </div>
  );
}

/** The three kinds of night, with the tints the calendar uses. */
const LEGEND = [
  { label: 'Rooms free', swatch: 'bg-success-500' },
  { label: 'Sold out', swatch: 'bg-warning-500' },
  { label: 'Stop-sell', swatch: 'bg-danger-500' },
];

/** The nights shown, added up per room type and night: occupancy, booked room nights, sold-out and stop-sell nights. */
function MonthSummary({ calendar, month }: { calendar: InventoryCalendar; month: string }) {
  const nights = calendar.roomTypes.flatMap((room) => room.days);
  const onSale = nights.filter((night) => !night.stopSell);
  const total = onSale.reduce((sum, night) => sum + night.totalRooms, 0);
  // Occupancy is booked of the rooms for sale (stop-sell nights are not for sale), like the reports.
  const occupied = onSale.reduce((sum, night) => sum + night.bookedRooms, 0);
  const booked = nights.reduce((sum, night) => sum + night.bookedRooms, 0);
  const held = nights.reduce((sum, night) => sum + night.heldRooms, 0);
  const soldOut = nights.filter((night) => !night.stopSell && night.freeRooms === 0).length;
  const stopped = nights.filter((night) => night.stopSell).length;
  return (
    <MetricGrid label={`Availability in ${month}`}>
      <MetricTile label="Occupancy" value={total > 0 ? (occupied / total) * 100 : 0} format={formatPercent} icon={<Percent />}
        hint="Booked of the rooms for sale" />
      <MetricTile label="Room nights booked" value={booked} format={formatCount} icon={<BedDouble />}
        hint={`${formatCount(held)} more held while guests pay`} />
      <MetricTile label="Sold-out nights" value={soldOut} format={formatCount} icon={<PackageX />}
        hint="Room type and night, no room left" />
      <MetricTile label="Stop-sell nights" value={stopped} format={formatCount} icon={<Ban />}
        hint="Closed for sale by the hotel" />
    </MetricGrid>
  );
}

function CalendarGrid({ calendar, month, selection, onSelect }: {
  calendar: InventoryCalendar;
  month: Date;
  selection: { roomTypeId: string; date: string } | null;
  onSelect: (selection: { roomTypeId: string; date: string }) => void;
}) {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const today = iso(new Date());
  const scrollerRef = useRef<HTMLDivElement>(null);
  // This month opens at today's column (the nights before it can no longer be changed); other months at their 1st.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const todayHeader = scroller?.querySelector<HTMLElement>('th[data-today]');
    const roomColumn = scroller?.querySelector<HTMLElement>('th[data-room-column]');
    if (!scroller) return;
    scroller.scrollLeft = todayHeader ? Math.max(0, todayHeader.offsetLeft - (roomColumn?.offsetWidth ?? 0) - 8) : 0;
  }, [month, calendar.roomTypes.length]);
  if (calendar.roomTypes.length === 0) {
    return <Alert tone="info">Add a room type under "Rooms & rates" first.</Alert>;
  }
  /** Weekend and today columns are tinted from the header to the last row. */
  const columnTint = (day: Date) => (iso(day) === today ? 'bg-role-50/70' : [0, 6].includes(day.getDay()) ? 'bg-slate-50' : '');
  return (
    <div ref={scrollerRef} className="relative overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-card animate-fade-up">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <caption className="sr-only">Rooms free / rooms for sale per night</caption>
        <thead>
          <tr>
            <th scope="col" data-room-column="" className={cn(STICKY_CELL, 'z-20 border-slate-200 py-3 text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500')}>
              Room type
            </th>
            {days.map((day) => {
              const isToday = iso(day) === today;
              const weekend = [0, 6].includes(day.getDay());
              return (
                <th key={iso(day)} scope="col" data-today={isToday ? '' : undefined} className={cn('min-w-14 border-b border-slate-200 px-1 pb-2 pt-2.5 text-center', columnTint(day))}>
                  <span className={cn('block text-[0.625rem] font-semibold uppercase tracking-wider', weekend ? 'text-role-700' : 'text-slate-500')}>
                    {format(day, 'EEE')}
                  </span>
                  <span className={cn('mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm font-bold',
                    isToday ? 'bg-role-600 text-white shadow-sm' : 'text-slate-900')}>
                    {format(day, 'd')}
                  </span>
                  {isToday && <span className="sr-only"> (today)</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {calendar.roomTypes.map((room) => {
            const byDate = new Map(room.days.map((d) => [d.date, d]));
            return (
              <tr key={room.roomTypeId}>
                <th scope="row" className={cn(STICKY_CELL, 'z-10 border-slate-100 py-2 text-sm font-semibold text-slate-900')}>
                  {room.name}
                  <span className="block text-xs font-normal text-slate-500">{room.defaultTotalRooms} rooms{room.status === 'INACTIVE' ? ' · not on sale' : ''}</span>
                </th>
                {days.map((day) => {
                  const night = byDate.get(iso(day));
                  const selected = selection?.roomTypeId === room.roomTypeId && selection.date === iso(day);
                  return (
                    <td key={iso(day)} className={cn('border-b border-slate-100 p-1', columnTint(day))}>
                      {night ? (
                        <NightCell night={night} selected={selected} onClick={() => onSelect({ roomTypeId: room.roomTypeId, date: night.date })} />
                      ) : (
                        <span className="block rounded-lg bg-slate-100/80 py-3.5 text-center text-slate-400" title="Not for sale (past or beyond the sales window)">–</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The small caption above a group of form fields. */
const LEGEND_CLASS = 'mb-3 text-xs font-bold uppercase tracking-wider text-slate-500';

/** The room type column: stays in view while the nights scroll sideways, with a hairline on its right. */
const STICKY_CELL = 'sticky left-0 min-w-32 border-b bg-white px-3 text-left sm:min-w-40 sm:px-4 shadow-[inset_-1px_0_0_var(--color-slate-200)]';

const NIGHT_TONES = {
  free: { surface: 'bg-success-50 text-success-700 hover:bg-success-100', ring: 'ring-1 ring-inset ring-success-200', bar: 'bg-success-500' },
  soldOut: { surface: 'bg-warning-50 text-warning-700 hover:bg-warning-100', ring: 'ring-1 ring-inset ring-warning-200', bar: 'bg-warning-500' },
  stopSell: {
    surface: 'bg-danger-50 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(240_68_56/0.08)_6px_8px)] text-danger-700 hover:bg-danger-100',
    ring: 'ring-1 ring-inset ring-danger-200',
    bar: 'bg-danger-500',
  },
} as const;

function NightCell({ night, selected, onClick }: { night: InventoryDay; selected: boolean; onClick: () => void }) {
  const tone = NIGHT_TONES[night.stopSell ? 'stopSell' : night.freeRooms === 0 ? 'soldOut' : 'free'];
  const label = `${formatDate(night.date)}: ${night.freeRooms} of ${night.totalRooms} free, ${night.bookedRooms} booked, ${night.heldRooms} held${night.stopSell ? ', stop-sell' : ''}${night.price !== null ? `, from ${formatMoney(night.price)}` : ''}`;
  const taken = night.totalRooms > 0 ? Math.min(100, ((night.bookedRooms + night.heldRooms) / night.totalRooms) * 100) : 100;
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={selected}
      className={cn('block w-full rounded-lg px-1 pb-1 pt-1.5 text-center leading-tight transition-[background-color,box-shadow] duration-(--duration-fast)',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-600',
        tone.surface, selected ? 'shadow-md ring-2 ring-role-600' : tone.ring)}>
      <span className="block text-[0.8125rem] font-bold tabular-nums">{night.freeRooms}/{night.totalRooms}</span>
      {night.price !== null && <span className="block text-[0.625rem] font-medium opacity-80">{Math.round(night.price / 100) / 10}k</span>}
      {/* How full the night is: booked and held of the rooms for sale. */}
      <span aria-hidden="true" className="mx-0.5 mt-1 block h-1 overflow-hidden rounded-full bg-white/80">
        <span className={cn('block h-full rounded-full opacity-60', tone.bar)} style={{ width: `${taken}%` }} />
      </span>
    </button>
  );
}

function UpdateForm({ hotelId, calendar, selection }: {
  hotelId: string;
  calendar: InventoryCalendar;
  selection: { roomTypeId: string; date: string } | null;
}) {
  const queryClient = useQueryClient();
  const sectionRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const firstRoom = calendar.roomTypes[0]?.roomTypeId ?? '';
  const room = selection ? calendar.roomTypes.find((r) => r.roomTypeId === selection.roomTypeId) : undefined;
  const night = selection ? room?.days.find((d) => d.date === selection.date) : undefined;
  const { register, handleSubmit, control, formState: { errors } } = useForm<InventoryUpdateForm>({
    resolver: zodResolver(inventoryUpdateSchema),
    defaultValues: {
      roomTypeId: selection?.roomTypeId ?? firstRoom,
      from: selection?.date ?? '',
      to: selection?.date ?? '',
      totalRooms: night ? String(night.totalRooms) : '',
      stopSell: 'unchanged',
    },
  });
  const [firstNight, lastNight] = useWatch({ control, name: ['from', 'to'] });
  const save = useMutation({
    mutationFn: (form: InventoryUpdateForm) => managerApi.updateInventory(hotelId, {
      roomTypeId: form.roomTypeId,
      from: form.from,
      to: form.to,
      totalRooms: form.totalRooms.trim() === '' ? undefined : Number(form.totalRooms),
      stopSell: form.stopSell === 'unchanged' ? undefined : form.stopSell === 'on',
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hotelManager.inventory(hotelId) });
      toast.success('Inventory updated.');
    },
  });
  const error = save.error ? ApiError.from(save.error) : null;

  // The form mounts again for every chosen night (its key): bring it into view, so the change is one step away.
  useEffect(() => {
    if (!selection) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    sectionRef.current?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
  }, [selection]);

  return (
    <section ref={sectionRef} aria-labelledby={headingId}
      className="scroll-mt-24 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card animate-fade-up sm:p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-role-50 text-role-600 ring-1 ring-inset ring-role-100">
          <SlidersHorizontal className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 id={headingId} className="text-base font-bold text-slate-900">Change availability</h3>
          <p className="text-sm text-slate-500">Select a night in the calendar or choose a range. Booked and held rooms are never taken away.</p>
        </div>
      </div>
      {night && room && (
        <div role="group" aria-label="Selected night"
          className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-role-50/70 p-3 ring-1 ring-inset ring-role-100">
          <span className="mr-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <CalendarDays className="size-4 text-role-600" aria-hidden="true" />
            {room.name} · {formatDate(night.date)}
          </span>
          <FactChip>{night.bookedRooms} booked</FactChip>
          <FactChip>{night.heldRooms} held</FactChip>
          <FactChip>{night.freeRooms} free</FactChip>
          {night.stopSell && <Badge tone="danger" dot>Stop-sell on</Badge>}
        </div>
      )}
      <form onSubmit={handleSubmit((form) => save.mutate(form))} noValidate className="mt-5 flex flex-col gap-4">
        {error?.code === 'INVENTORY_BELOW_RESERVED' ? (
          <Alert tone="danger" title="Fewer rooms than already booked or held">
            {(error.details.nights as string[] | undefined)?.slice(0, 8).map(formatDate).join(', ')}
          </Alert>
        ) : error && <Alert tone="danger">{error.message}</Alert>}
        {/* Columns of at least ~200 px, so a date ("Wed, 30 Sep 2026") fits; the two nights stay side by side. */}
        <fieldset>
          <legend className={LEGEND_CLASS}>Nights</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-1">
              <SelectField label="Room type" error={errors.roomTypeId?.message} {...register('roomTypeId')}>
                {calendar.roomTypes.map((r) => <option key={r.roomTypeId} value={r.roomTypeId}>{r.name}</option>)}
              </SelectField>
            </div>
            <Controller control={control} name="from" render={({ field }) => (
              <DateField label="First night" min={todayIso()} max={calendar.lastSellableNight} error={errors.from?.message}
                rangeEnd={lastNight} {...field} />
            )} />
            <Controller control={control} name="to" render={({ field }) => (
              <DateField label="Last night" min={todayIso()} max={calendar.lastSellableNight} error={errors.to?.message}
                rangeStart={firstNight} {...field} />
            )} />
          </div>
        </fieldset>
        <fieldset>
          <legend className={LEGEND_CLASS}>Change</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label="Rooms for sale" optional inputMode="numeric" placeholder="unchanged" error={errors.totalRooms?.message} {...register('totalRooms')} />
            <SelectField label="Stop-sell" {...register('stopSell')}>
              <option value="unchanged">Unchanged</option>
              <option value="on">On (close sales)</option>
              <option value="off">Off (open sales)</option>
            </SelectField>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <Button type="submit" loading={save.isPending}>Apply</Button>
          <p className="text-xs text-slate-500">Changes apply to every night from the first to the last, for the chosen room type.</p>
        </div>
      </form>
    </section>
  );
}
