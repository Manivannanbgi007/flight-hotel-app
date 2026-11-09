import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { Check, ChevronDown, Clock } from 'lucide-react';

import { cn } from '@/lib/cn';
import { FieldChrome, type FieldChromeProps } from './Field';
import { describedBy, useFieldIds } from './fieldIds';
import { controlClass } from './fieldStyles';
import { FloatingPanel } from './FloatingPanel';
import { formatTime12h, isCompleteTime, minutesToTime, parseTypedTime, timeToMinutes } from './pickerValues';

export interface TimeFieldProps extends FieldChromeProps {
  /** 24-hour "HH:mm" or '' for none. */
  value: string | null | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Also submits the value under this name in a native form (a hidden input). */
  name?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Minutes between the suggested times (default 30). Any minute can still be typed. */
  step?: number;
  /** First and last suggested time ("HH:mm"; default the whole day). */
  min?: string;
  max?: string;
  className?: string;
}

/** Where the list opens when no time is chosen yet: the start of a working day. */
const DEFAULT_SCROLL_MINUTES = 8 * 60;

/**
 * A time of day with a list of suggested times (every half hour by default, each also shown as "2:30 PM"). The time
 * can be typed as 14:30, 1430 or 2:30 pm. Works with react-hook-form through `Controller`.
 *
 * Keyboard (combobox): ↓/↑ open the list and move through it, Home/End, Page Up/Down, Enter chooses, Escape closes.
 */
export const TimeField = forwardRef<HTMLInputElement, TimeFieldProps>(function TimeField(
  {
    label,
    hint,
    error,
    optional,
    id,
    value,
    onChange,
    onBlur,
    name,
    disabled = false,
    placeholder = 'HH:MM',
    step = 30,
    min,
    max,
    className,
  },
  ref,
) {
  const ids = useFieldIds(id);
  const listId = `${ids.controlId}-times`;
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** The first scroll after opening centres the chosen time; later ones only keep the active time in view. */
  const justOpened = useRef(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const current = value ?? '';

  const slots = useMemo(() => {
    const first = Number.isNaN(timeToMinutes(min)) ? 0 : timeToMinutes(min);
    const last = Number.isNaN(timeToMinutes(max)) ? 24 * 60 - 1 : timeToMinutes(max);
    const every = Math.max(1, Math.round(step));
    const times: string[] = [];
    for (let minutes = first; minutes <= last; minutes += every) times.push(minutesToTime(minutes));
    return times;
  }, [step, min, max]);

  /** The suggested time at or just after this time (the last one when it is later than all). */
  const nearest = (time: string): number => {
    const minutes = timeToMinutes(time);
    if (Number.isNaN(minutes)) return -1;
    const index = slots.findIndex((slot) => timeToMinutes(slot) >= minutes);
    return index === -1 ? slots.length - 1 : index;
  };

  useEffect(() => {
    if (!open) return;
    const target =
      active >= 0
        ? document.getElementById(`${listId}-${active}`)
        : listRef.current?.querySelector<HTMLElement>(
            `[data-minutes="${slots[Math.max(nearest(minutesToTime(DEFAULT_SCROLL_MINUTES)), 0)]}"]`,
          );
    target?.scrollIntoView?.({ block: active < 0 ? 'start' : justOpened.current ? 'center' : 'nearest' });
    justOpened.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll only when the list opens or the active time moves
  }, [open, active]);

  const openList = () => {
    if (disabled || open) return;
    setActive(nearest(current));
    justOpened.current = true;
    setOpen(true);
  };

  const choose = (time: string) => {
    setTyped(null);
    setOpen(false);
    if (time !== current) onChange(time);
  };

  const onType = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    setTyped(text);
    if (!open) setOpen(true);
    if (text.trim() === '') {
      if (current !== '') onChange('');
      setActive(-1);
      return;
    }
    const parsed = parseTypedTime(text);
    if (parsed !== null) {
      setActive(nearest(parsed));
      if (isCompleteTime(text) && parsed !== current) onChange(parsed);
    }
  };

  /** Takes a short typed time ("9" → 09:00) when the person moves on; unfinished text shows the chosen time again. */
  const settleTyped = () => {
    if (typed === null) return;
    const parsed = parseTypedTime(typed);
    if (parsed !== null && parsed !== current) onChange(parsed);
    setTyped(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = slots.length - 1;
    const move = (to: number) => {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      setActive(Math.min(Math.max(to, 0), last));
    };
    switch (event.key) {
      case 'ArrowDown':
        move(active + 1);
        break;
      case 'ArrowUp':
        move(active === -1 ? last : active - 1);
        break;
      case 'PageDown':
        if (open) move(active + 4);
        break;
      case 'PageUp':
        if (open) move(active - 4);
        break;
      case 'Home':
        if (open) move(0);
        break;
      case 'End':
        if (open) move(last);
        break;
      case 'Enter':
        if (open) {
          event.preventDefault();
          if (typed !== null && parseTypedTime(typed) !== null) {
            settleTyped();
            setOpen(false);
          } else if (active >= 0 && slots[active]) choose(slots[active]);
          else {
            setTyped(null);
            setOpen(false);
          }
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setTyped(null);
          setOpen(false);
        }
        break;
      default:
        break;
    }
  };

  const onWrapperBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    settleTyped();
    setOpen(false);
    onBlur?.();
  };

  return (
    <FieldChrome {...ids} label={label} hint={hint} error={error} optional={optional}>
      <div ref={anchorRef} className="relative" onBlur={onWrapperBlur}>
        <Clock
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-role-600"
          aria-hidden="true"
        />
        <input
          ref={ref}
          id={ids.controlId}
          type="text"
          role="combobox"
          aria-autocomplete="none"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error, hint, ids.hintId, ids.errorId)}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          disabled={disabled}
          value={typed ?? current}
          data-value={current}
          onChange={onType}
          onClick={openList}
          onKeyDown={onKeyDown}
          className={cn(controlClass(Boolean(error)), 'cursor-pointer pl-10 pr-9 font-medium tabular-nums', className)}
        />
        <ChevronDown
          className={cn(
            'pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 transition-transform duration-(--duration-base) ease-out-soft',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
        {name && <input type="hidden" name={name} value={current} />}
        {open && slots.length > 0 && (
          <FloatingPanel anchor={anchorRef} onDismiss={() => setOpen(false)} matchWidth className="max-h-64 w-max">
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Suggested times"
              // Keep focus in the field while an option is pressed.
              onMouseDown={(event) => event.preventDefault()}
              className="flex flex-col gap-0.5"
            >
              {slots.map((slot, index) => {
                const chosen = slot === current;
                return (
                  <li
                    key={slot}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    data-minutes={slot}
                    onClick={() => choose(slot)}
                    onPointerEnter={() => setActive(index)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm tabular-nums transition-colors duration-(--duration-fast)',
                      index === active ? 'bg-slate-100 text-slate-900' : 'text-slate-700',
                      chosen && 'bg-role-50 font-semibold text-role-700',
                    )}
                  >
                    <span className="font-semibold">{slot}</span>
                    <span className={cn('text-xs', chosen ? 'text-role-600' : 'text-slate-500')}>{formatTime12h(slot)}</span>
                    <Check className={cn('ml-auto size-4 text-role-600', !chosen && 'invisible')} aria-hidden="true" />
                  </li>
                );
              })}
            </ul>
          </FloatingPanel>
        )}
      </div>
    </FieldChrome>
  );
});
