import { useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { CheckboxField } from '@/components/ui/Field';
import { controlClass } from '@/components/ui/fieldStyles';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { EMPTY_FILTERS, type HotelFilters as Filters } from './searchParams';
import { PROPERTY_TYPE_LABELS, type Amenity, type PropertyType, type SearchResponse } from './types';

/** The amenities people filter by most; the rest are behind "Show all". */
const POPULAR_AMENITIES = ['FREE_WIFI', 'POOL', 'PARKING', 'RESTAURANT', 'SPA', 'GYM', 'BEACH_ACCESS', 'AIRPORT_SHUTTLE'];
const DISTANCES = [1, 2, 5, 10, 25];
const RATINGS = [3.5, 4, 4.5];

/**
 * The filter panel. Every change is applied immediately (the URL changes and the results reload), except the price
 * range, which is applied with its button so typing does not trigger a search per key.
 */
export function HotelFilters({ filters, facets, amenities, destinationCity, onChange }: {
  filters: Filters;
  facets: SearchResponse['facets'] | undefined;
  amenities: Amenity[];
  destinationCity: string | null;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const [showAllAmenities, setShowAllAmenities] = useState(false);
  const hotelAmenities = amenities.filter((a) => a.category === 'HOTEL');
  const shownAmenities = showAllAmenities ? hotelAmenities
    : hotelAmenities.filter((a) => POPULAR_AMENITIES.includes(a.code) || filters.amenities.includes(a.code));
  const active = JSON.stringify({ ...filters, sort: 'RECOMMENDED', page: 0 }) !== JSON.stringify({ ...EMPTY_FILTERS });

  const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
            <SlidersHorizontal className="size-4" />
          </span>
          Filters
        </h2>
        {active && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort })}>
            Clear all
          </Button>
        )}
      </div>

      <PriceFilter key={`${filters.minPrice}-${filters.maxPrice}`} filters={filters} facets={facets} onChange={onChange} />

      <Group title="Popular">
        <CheckboxField label="Free cancellation" checked={filters.freeCancellation}
          onChange={(e) => onChange({ freeCancellation: e.target.checked })} />
        <CheckboxField label="Breakfast included" checked={filters.breakfastIncluded}
          onChange={(e) => onChange({ breakfastIncluded: e.target.checked })} />
      </Group>

      <Group title="Star rating">
        {[5, 4, 3, 2, 1].map((stars) => (
          <CheckboxField key={stars} label={`${stars} star${stars === 1 ? '' : 's'}${facets?.stars[stars] ? ` (${facets.stars[stars]})` : ''}`}
            checked={filters.stars.includes(stars)} onChange={() => onChange({ stars: toggle(filters.stars, stars) })} />
        ))}
      </Group>

      <Group title="Guest rating">
        <RadioList
          name="rating"
          value={filters.minGuestRating === undefined ? '' : String(filters.minGuestRating)}
          options={[{ value: '', label: 'Any' }, ...RATINGS.map((r) => ({ value: String(r), label: `${r}+` }))]}
          onChange={(value) => onChange({ minGuestRating: value === '' ? undefined : Number(value) })}
          inline
        />
      </Group>

      <Group title="Property type">
        {(Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]).map((type) => (
          <CheckboxField key={type} label={PROPERTY_TYPE_LABELS[type]} checked={filters.propertyTypes.includes(type)}
            onChange={() => onChange({ propertyTypes: toggle(filters.propertyTypes, type) })} />
        ))}
      </Group>

      <Group title="Amenities">
        {shownAmenities.map((amenity) => (
          <CheckboxField key={amenity.code} label={amenity.name} checked={filters.amenities.includes(amenity.code)}
            onChange={() => onChange({ amenities: toggle(filters.amenities, amenity.code) })} />
        ))}
        {hotelAmenities.length > shownAmenities.length && (
          <button type="button" className="self-start rounded-md text-sm font-semibold text-brand-700 hover:underline"
            onClick={() => setShowAllAmenities(true)}>
            Show all amenities
          </button>
        )}
      </Group>

      <Group title={destinationCity ? `Distance from ${destinationCity} centre` : 'Distance'}>
        {destinationCity ? (
          <RadioList
            name="distance"
            value={filters.maxDistanceKm === undefined ? '' : String(filters.maxDistanceKm)}
            options={[{ value: '', label: 'Any distance' }, ...DISTANCES.map((km) => ({ value: String(km), label: `Within ${km} km` }))]}
            onChange={(value) => onChange({ maxDistanceKm: value === '' ? undefined : Number(value) })}
          />
        ) : (
          <p className="text-sm text-slate-600">Search for a city to filter by distance.</p>
        )}
      </Group>

      <Group title="Availability">
        <CheckboxField label="Also show hotels that are full for my dates" checked={filters.showUnavailable}
          onChange={(e) => onChange({ showUnavailable: e.target.checked })} />
      </Group>
    </div>
  );
}

function PriceFilter({ filters, facets, onChange }: {
  filters: Filters;
  facets: SearchResponse['facets'] | undefined;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const [min, setMin] = useState(filters.minPrice === undefined ? '' : String(filters.minPrice));
  const [max, setMax] = useState(filters.maxPrice === undefined ? '' : String(filters.maxPrice));
  const parse = (value: string) => (value.trim() === '' || Number.isNaN(Number(value)) ? undefined : Math.max(0, Number(value)));
  return (
    <Group title="Price per night">
      {facets?.minPrice != null && facets.maxPrice != null && (
        <p className="text-xs text-slate-600">
          From {formatMoney(facets.minPrice)} to {formatMoney(facets.maxPrice)} for these results
        </p>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onChange({ minPrice: parse(min), maxPrice: parse(max) });
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-slate-700">
          Min (₹)
          <input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)}
            className={controlClass(false)} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-slate-700">
          Max (₹)
          <input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)}
            className={controlClass(false)} />
        </label>
        <Button type="submit" variant="secondary">Apply</Button>
      </form>
    </Group>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2.5 border-t border-slate-100 pt-4">
      <legend className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-600">{title}</legend>
      {children}
    </fieldset>
  );
}

function RadioList({ name, value, options, onChange, inline = false }: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  /** Pills in a row (short labels) instead of a list. */
  inline?: boolean;
}) {
  return (
    <div className={inline ? 'flex flex-wrap gap-1.5' : 'flex flex-col gap-2'}>
      {options.map((option) => {
        const checked = value === option.value;
        return inline ? (
          <label
            key={option.value}
            className={cn(
              'cursor-pointer rounded-full px-3 py-1 text-sm font-semibold ring-1 transition-colors duration-(--duration-fast)',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
              checked ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300 hover:ring-slate-400',
            )}
          >
            <input type="radio" name={name} value={option.value} checked={checked} onChange={() => onChange(option.value)} className="sr-only" />
            {option.label}
          </label>
        ) : (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="radio" name={name} value={option.value} checked={checked}
              onChange={() => onChange(option.value)} className="size-4 accent-brand-600" />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
