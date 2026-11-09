import { useDeferredValue, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { addDays, format, parseISO } from 'date-fns';
import { Baby, BedDouble, MapPin, Search, Users, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { DateField } from '@/components/ui/DateField';
import { SelectField } from '@/components/ui/Field';
import { SuggestField } from '@/components/ui/SuggestField';
import { todayIso } from '@/features/account/schemas';
import { recordHotelSearch } from '@/features/home/recentSearches';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { hotelApi } from './hotelApi';
import { hotelSearchSchema, type HotelSearchForm as FormValues } from './schemas';
import { MAX_ROOMS } from './searchParams';
import type { Stay } from './types';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const nextDay = (isoDate: string) => format(addDays(parseISO(isoDate), 1), 'yyyy-MM-dd');

/** A field label with a small decorative icon (the accessible name stays the text). */
function IconLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-4 text-brand-600" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * Destination, dates, rooms and guests (with each child's age). Used on the home page, the hotels page and above
 * the results. Calls {@code onSearch} with validated values.
 */
export function HotelSearchForm({ destination = '', stay, onSearch, compact = false, showDestination = true,
  submitLabel = 'Search hotels' }: {
  destination?: string;
  stay: Stay;
  onSearch: (destination: string, stay: Stay) => void;
  compact?: boolean;
  /** false on a hotel page: only dates and guests change. */
  showDestination?: boolean;
  submitLabel?: string;
}) {
  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { errors, isSubmitted },
  } = useForm<FormValues>({
    resolver: zodResolver(hotelSearchSchema),
    defaultValues: { destination, ...stay, childAges: stay.childAges },
  });
  const [typed, children, checkIn, checkOut] = useWatch({ control, name: ['destination', 'children', 'checkIn', 'checkOut'] });
  const query = useDeferredValue(typed.trim());

  const suggestions = useQuery({
    queryKey: queryKeys.hotels.destinations(query.toLowerCase()),
    queryFn: () => hotelApi.destinations(query),
    enabled: query.length >= 1,
    staleTime: 5 * 60_000,
  });

  const submit = handleSubmit((form) => {
    const chosen: Stay = {
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      rooms: form.rooms,
      adults: form.adults,
      children: form.children,
      childAges: form.childAges.slice(0, form.children),
    };
    // A new search (not "Update prices" on a hotel page) goes to "Recently viewed searches" on this device.
    if (showDestination) recordHotelSearch(form.destination, chosen);
    onSearch(form.destination.trim(), chosen);
  });

  return (
    <form onSubmit={submit} noValidate role="search" aria-label="Search hotels" className="flex flex-col gap-4">
      <div
        className={cn(
          'grid grid-cols-2 gap-3 sm:gap-4',
          compact
            ? showDestination
              ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto_auto]'
              : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto_auto]'
            : 'lg:grid-cols-12',
        )}
      >
        {showDestination ? (
          <div className={cn('col-span-2', compact ? 'lg:col-span-1' : 'lg:col-span-6')}>
            <Controller
              control={control}
              name="destination"
              render={({ field }) => (
                <SuggestField
                  label="Destination"
                  icon={<MapPin />}
                  placeholder="City or hotel, e.g. Goa"
                  error={errors.destination?.message}
                  suggestions={
                    query.length >= 1
                      ? (suggestions.data ?? []).map((s) => ({
                          value: s.city,
                          description: `${s.hotels} hotel${s.hotels === 1 ? '' : 's'}`,
                        }))
                      : []
                  }
                  {...field}
                />
              )}
            />
          </div>
        ) : (
          <input type="hidden" {...register('destination')} />
        )}
        {/* Travel dates: two months side by side, the stay shaded; the calendar's own icon replaces the label icon. */}
        <div className={cn('min-w-0', !compact && 'lg:col-span-3')}>
          <Controller
            control={control}
            name="checkIn"
            render={({ field }) => (
              <DateField
                label="Check-in"
                months={2}
                min={todayIso()}
                rangeEnd={checkOut}
                error={errors.checkIn?.message}
                {...field}
                onChange={(value) => {
                  field.onChange(value);
                  // A check-in on or after the check-out moves the check-out to the next day (one night).
                  const out = getValues('checkOut');
                  if (value && out && value >= out) setValue('checkOut', nextDay(value), { shouldValidate: isSubmitted });
                }}
              />
            )}
          />
        </div>
        <div className={cn('min-w-0', !compact && 'lg:col-span-3')}>
          <Controller
            control={control}
            name="checkOut"
            render={({ field }) => (
              <DateField
                label="Check-out"
                months={2}
                min={checkIn && checkIn >= todayIso() ? nextDay(checkIn) : nextDay(todayIso())}
                rangeStart={checkIn}
                error={errors.checkOut?.message}
                {...field}
              />
            )}
          />
        </div>
        <div className={cn('col-span-2 grid grid-cols-3 gap-3 sm:gap-4', compact ? 'lg:contents' : 'lg:col-span-8')}>
          <SelectField label={<IconLabel icon={BedDouble}>Rooms</IconLabel>} {...register('rooms', { valueAsNumber: true })}>
            {range(1, MAX_ROOMS).map((n) => <option key={n} value={n}>{n}</option>)}
          </SelectField>
          <SelectField label={<IconLabel icon={Users}>Adults</IconLabel>} error={errors.adults?.message}
            {...register('adults', { valueAsNumber: true })}>
            {range(1, 16).map((n) => <option key={n} value={n}>{n}</option>)}
          </SelectField>
          <SelectField label={<IconLabel icon={Baby}>Children</IconLabel>} {...register('children', { valueAsNumber: true })}>
            {range(0, 8).map((n) => <option key={n} value={n}>{n}</option>)}
          </SelectField>
        </div>
        <div className={cn('col-span-2 flex items-end', compact ? 'lg:col-span-1' : 'lg:col-span-4')}>
          <Button type="submit" size="lg" className="w-full">
            <Search className="size-4" aria-hidden="true" />
            {submitLabel}
          </Button>
        </div>
      </div>

      {children > 0 && (
        <fieldset className="flex flex-wrap gap-3 rounded-2xl border border-brand-100 bg-brand-50/50 px-4 pb-4 pt-1 animate-fade-in">
          <legend className="px-1 text-sm font-semibold text-slate-800">Age of each child at check-in</legend>
          {range(1, children).map((n) => (
            <div key={n} className="w-28">
              <SelectField
                label={`Child ${n}`}
                error={errors.childAges?.[n - 1]?.message}
                {...register(`childAges.${n - 1}`, { valueAsNumber: true })}
              >
                <option value={-1}>Age?</option>
                {range(0, 17).map((age) => (
                  <option key={age} value={age}>{age === 0 ? 'Under 1' : `${age} yr${age === 1 ? '' : 's'}`}</option>
                ))}
              </SelectField>
            </div>
          ))}
        </fieldset>
      )}
    </form>
  );
}
