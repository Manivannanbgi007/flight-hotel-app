import { useId, useState, type FormEvent } from 'react';
import { CalendarRange } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { DateField } from '@/components/ui/DateField';
import { cn } from '@/lib/cn';
import type { SummaryParams, SummaryPreset } from './summaryApi';
import { PRESETS, validateCustomRange } from './summaryRange';

/**
 * The dashboard's period: preset pills (real radio buttons, so arrow keys move between them) and, for "Custom", two
 * dates with "Apply". A preset applies at once; custom dates apply after they were checked.
 */
export function RangeFilter({ value, onChange, className }: {
  value: SummaryParams;
  onChange: (params: SummaryParams) => void;
  className?: string;
}) {
  const name = useId();
  const errorId = useId();
  const [choosingCustom, setChoosingCustom] = useState(false);
  const [from, setFrom] = useState(value.from ?? '');
  const [to, setTo] = useState(value.to ?? '');
  const [error, setError] = useState<string | null>(null);
  const selected: SummaryPreset = choosingCustom ? 'CUSTOM' : value.range;

  const choose = (preset: SummaryPreset) => {
    setError(null);
    if (preset === 'CUSTOM') {
      setChoosingCustom(true);
      return;
    }
    setChoosingCustom(false);
    onChange({ range: preset });
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const problem = validateCustomRange(from, to);
    setError(problem);
    if (!problem) {
      setChoosingCustom(false);
      onChange({ range: 'CUSTOM', from, to });
    }
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">Period</legend>
        <div className="flex flex-wrap gap-1 rounded-2xl bg-slate-100/90 p-1 ring-1 ring-inset ring-slate-200/70">
          {PRESETS.map((preset) => (
            <label
              key={preset.value}
              className={cn(
                'relative cursor-pointer rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors duration-(--duration-fast)',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
                selected === preset.value ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
              )}
            >
              <input
                type="radio"
                name={name}
                value={preset.value}
                checked={selected === preset.value}
                onChange={() => choose(preset.value)}
                // Transparent and as big as the pill: the whole pill is the control (and clear of the sticky header
                // when the browser scrolls it into view).
                className="absolute inset-0 size-full cursor-pointer scroll-mt-28 appearance-none rounded-xl opacity-0"
              />
              {preset.label}
            </label>
          ))}
        </div>
      </fieldset>

      {selected === 'CUSTOM' && (
        <form onSubmit={apply} noValidate className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs animate-slide-down">
          <CalendarRange aria-hidden="true" className="mb-2.5 hidden size-5 text-brand-600 sm:block" />
          <div className="min-w-48 flex-1 sm:w-52 sm:flex-none">
            <DateField label="From" value={from} onChange={setFrom} rangeEnd={to}
              aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} />
          </div>
          <div className="min-w-48 flex-1 sm:w-52 sm:flex-none">
            <DateField label="To" value={to} min={from || undefined} onChange={setTo} rangeStart={from}
              aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} />
          </div>
          <Button type="submit" variant="secondary">Apply</Button>
          {error && <p id={errorId} role="alert" className="w-full text-sm font-medium text-danger-700">{error}</p>}
        </form>
      )}
    </div>
  );
}
