import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { DateField } from '@/components/ui/DateField';
import { SelectField } from '@/components/ui/Field';
import { RANGE_PRESETS, validateCustomRange, type DateRange, type RangePreset } from './dateRange';

/**
 * The 7 presets of API_DOCUMENTATION.md §14.0, plus custom dates (both inclusive, at most 366 days). A preset applies
 * at once; custom dates apply with "Apply" after they were checked.
 */
export function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const [choosingCustom, setChoosingCustom] = useState(value.preset === 'CUSTOM');
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const showCustom = choosingCustom || value.preset === 'CUSTOM';

  const onPreset = (preset: RangePreset) => {
    setError(null);
    if (preset === 'CUSTOM') {
      setChoosingCustom(true);
      return;
    }
    setChoosingCustom(false);
    onChange({ preset, from: '', to: '' });
  };

  const apply = () => {
    const problem = validateCustomRange(from, to);
    setError(problem);
    if (!problem) {
      onChange({ preset: 'CUSTOM', from, to });
    }
  };

  return (
    <fieldset className="flex flex-wrap items-end gap-3">
      <legend className="sr-only">Date range</legend>
      <div className="w-full sm:w-48">
        <SelectField label="Date range" value={showCustom ? 'CUSTOM' : value.preset} onChange={(event) => onPreset(event.target.value as RangePreset)}>
          {RANGE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
        </SelectField>
      </div>
      {showCustom && (
        <>
          <div className="min-w-48 flex-1 sm:w-52 sm:flex-none">
            <DateField label="From" value={from} onChange={setFrom} rangeEnd={to}
              aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} />
          </div>
          <div className="min-w-48 flex-1 sm:w-52 sm:flex-none">
            <DateField label="To" value={to} min={from || undefined} onChange={setTo} rangeStart={from}
              aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} />
          </div>
          <Button variant="secondary" onClick={apply}>Apply</Button>
        </>
      )}
      {error && <p id={errorId} role="alert" className="w-full text-sm text-danger-600">{error}</p>}
    </fieldset>
  );
}
