import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, MapPin } from 'lucide-react';

import { controlClass } from '@/components/ui/fieldStyles';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { flightApi } from './flightApi';
import type { Airport } from './types';

/**
 * Airport picker with suggestions (typed text → debounced search by code, city or name). The value is the IATA code:
 * it is empty until an airport was chosen from the list, so free text can never be searched.
 */
export function AirportField({ label, value, onChange, error, icon }: {
  label: string;
  /** IATA code, '' when nothing is chosen. */
  value: string;
  onChange: (code: string, airport?: Airport) => void;
  error?: string;
  /** A small decorative icon inside the field (take-off, landing). */
  icon?: ReactNode;
}) {
  const inputId = useId();
  const listId = `${inputId}-list`;
  const errorId = `${inputId}-error`;
  // `typed` is what the customer is typing right now (null = show the chosen airport).
  const [typed, setTyped] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const display = typed ?? (value ? (labels[value] ?? value) : '');
  const query = useDebouncedValue((typed ?? '').trim(), 250);
  const chosen = value !== '' && typed === null;

  const suggestions = useQuery({
    queryKey: queryKeys.flights.airports(query.toLowerCase()),
    queryFn: () => flightApi.searchAirports(query),
    enabled: open && query.length >= 2 && !chosen,
    staleTime: 10 * 60_000,
  });
  const options = suggestions.data ?? [];
  const expanded = open && options.length > 0 && !chosen;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const choose = (airport: Airport) => {
    setLabels((known) => ({ ...known, [airport.iataCode]: `${airport.city} (${airport.iataCode})` }));
    setTyped(null);
    setOpen(false);
    onChange(airport.iataCode, airport);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && options.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open && options[active] && !chosen) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative flex min-w-0 flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-slate-800">{label}</label>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-brand-600">
          {icon ?? <MapPin className="size-4" />}
        </span>
        <input
          id={inputId}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && options[active] ? `${listId}-${options[active].iataCode}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          placeholder="City or airport"
          value={display}
          onChange={(event) => {
            setTyped(event.target.value);
            setOpen(true);
            setActive(0);
            if (value !== '') onChange('');
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(controlClass(Boolean(error)), 'pl-10 font-medium')}
        />
      </div>
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-danger-600">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      {expanded && (
        <ul id={listId} role="listbox" aria-label={`${label} suggestions`}
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-72 overflow-auto rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-xl animate-scale-in">
          {options.map((airport, index) => (
            <li
              key={airport.iataCode}
              id={`${listId}-${airport.iataCode}`}
              role="option"
              aria-selected={index === active}
              onClick={() => choose(airport)}
              onPointerEnter={() => setActive(index)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-(--duration-fast)',
                index === active ? 'bg-brand-50' : 'hover:bg-slate-50',
              )}
            >
              <span aria-hidden="true" className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-xs font-bold text-brand-700 ring-1 ring-brand-100">
                {airport.iataCode}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold text-slate-900">{airport.city} ({airport.iataCode})</span>
                <span className="truncate text-xs text-slate-500">{airport.name}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
