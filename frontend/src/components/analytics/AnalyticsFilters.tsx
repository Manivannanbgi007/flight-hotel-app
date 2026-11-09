import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarRange, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { DateField } from '@/components/ui/DateField';
import { SelectField } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import {
  autoInterval,
  CUSTOM_LABEL,
  describeDays,
  INTERVAL_LABELS,
  intervalOptions,
  presetDays,
  PRESET_GROUPS,
  validateAnalyticsDates,
  withRange,
  type AnalyticsInterval,
  type AnalyticsPreset,
  type AnalyticsQuery,
  type AnalyticsRangeEcho,
} from './range';
import { SegmentedControl } from './SegmentedControl';

/** What the server answered with: the real days, the interval it used and the period it compared with. */
export interface ServedRange {
  range: AnalyticsRangeEcho;
  interval: AnalyticsInterval;
  previousRange?: AnalyticsRangeEcho | null;
}

/**
 * The filter bar of the analytics dashboards: a preset (Today … Last 5 years) or custom dates (both inclusive, at most
 * five years), and the interval of the charts (Day, Week, Month, Year). Without a chosen interval the server picks one;
 * intervals the server would refuse for the range (too many points) are disabled, with the reason. The page keeps the
 * query in the URL; give the component `key={JSON.stringify(query)}` so it resets when the URL changes.
 */
export function AnalyticsFilters({ value, onChange, served, busy = false, extra, className }: {
  value: AnalyticsQuery;
  onChange: (next: AnalyticsQuery) => void;
  served?: ServedRange | null;
  /** A request for new figures is running (the old ones stay on screen). */
  busy?: boolean;
  /** More controls on the right (e.g. a hotel switcher). */
  extra?: ReactNode;
  className?: string;
}) {
  const [choosingCustom, setChoosingCustom] = useState(value.preset === 'CUSTOM');
  const [from, setFrom] = useState(value.from || served?.range.from || '');
  const [to, setTo] = useState(value.to || served?.range.to || '');
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = useId();
  const showCustom = choosingCustom || value.preset === 'CUSTOM';

  // The days of the current query: the server's echo when it is for this query, otherwise worked out here.
  const echoMatches = served && served.range.preset === value.preset
    && (value.preset !== 'CUSTOM' || (served.range.from === value.from && served.range.to === value.to));
  const days = echoMatches && served ? served.range : presetDays(value);
  const options = intervalOptions(days.from, days.to);
  const shownInterval = value.interval ?? (echoMatches && served ? served.interval : autoInterval(days.from, days.to));
  const refused = options.filter((option) => !option.allowed);

  const onPreset = (preset: AnalyticsPreset) => {
    setProblem(null);
    if (preset === 'CUSTOM') {
      setChoosingCustom(true);
      return;
    }
    setChoosingCustom(false);
    onChange(withRange(value, { preset, from: '', to: '' }));
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const issue = validateAnalyticsDates(from, to);
    setProblem(issue);
    if (!issue) onChange(withRange(value, { preset: 'CUSTOM', from, to }));
  };

  return (
    <div className={cn('flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-card sm:p-5', className)}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="w-full sm:w-56">
          <SelectField label="Date range" value={showCustom ? 'CUSTOM' : value.preset} onChange={(event) => onPreset(event.target.value as AnalyticsPreset)}>
            {PRESET_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.presets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
              </optgroup>
            ))}
            <option value="CUSTOM">{CUSTOM_LABEL}</option>
          </SelectField>
        </div>

        {showCustom && (
          <form aria-label="Custom dates" noValidate onSubmit={apply} className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
            <div className="min-w-48 flex-1 sm:w-52 sm:flex-none">
              <DateField label="From" value={from} onChange={setFrom} rangeEnd={to}
                aria-invalid={problem ? true : undefined} aria-describedby={problem ? problemId : undefined} />
            </div>
            <div className="min-w-48 flex-1 sm:w-52 sm:flex-none">
              <DateField label="To" value={to} min={from || undefined} onChange={setTo} rangeStart={from}
                aria-invalid={problem ? true : undefined} aria-describedby={problem ? problemId : undefined} />
            </div>
            <Button type="submit" variant="secondary">Apply</Button>
          </form>
        )}

        <SegmentedControl<AnalyticsInterval>
          legend="Interval"
          hint={value.interval ? undefined : 'chosen automatically'}
          value={shownInterval}
          onChange={(interval) => onChange({ ...value, interval })}
          options={options.map((option) => ({
            value: option.value,
            label: option.label,
            disabled: !option.allowed,
            description: option.reason ?? undefined,
          }))}
        />
        {value.interval && (
          <Button variant="ghost" size="sm" className="mb-1" onClick={() => onChange({ ...value, interval: null })}>
            Choose automatically
          </Button>
        )}
        {extra && <div className="ml-auto flex flex-wrap items-end gap-3">{extra}</div>}
      </div>

      {problem && <p id={problemId} role="alert" className="text-sm font-medium text-danger-600">{problem}</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-sm text-slate-600">
        <span className="inline-flex items-center gap-2">
          <CalendarRange className="size-4 text-role-600" aria-hidden="true" />
          {echoMatches && served ? (
            <span>
              Showing <strong className="font-semibold text-slate-900">{describeDays(served.range)}</strong>
              {' '}{INTERVAL_LABELS[served.interval].per}
              {served.previousRange && <> · compared with {describeDays(served.previousRange)}</>}
            </span>
          ) : (
            <span>Showing {describeDays(days)}</span>
          )}
        </span>
        {busy && (
          <span role="status" className="inline-flex items-center gap-1.5 text-role-700">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Updating…
          </span>
        )}
        {refused.length > 0 && (
          <span className="text-xs text-slate-500">
            {refused.map((option) => INTERVAL_LABELS[option.value].label).join(' and ')} not available: too many points for this range.
          </span>
        )}
      </div>
    </div>
  );
}
