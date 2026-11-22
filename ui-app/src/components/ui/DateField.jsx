import { forwardRef, useEffect, useRef, useState } from 'react';
import {
  addYears,
  differenceInCalendarMonths,
  endOfYear,
  isAfter,
  isBefore,
  startOfMonth,
  startOfToday,
  startOfYear,
  subYears,
} from 'date-fns';
import { CalendarDays, ChevronDown, Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { loadCalendar, loadedCalendar } from './calendarLoader';
import { FieldChrome } from './Field';
import { describedBy, useFieldIds } from './fieldIds';
import { controlClass } from './fieldStyles';
import { FloatingPanel } from './FloatingPanel';
import { dateToIso, formatFieldDate, isoToDate, parseTypedDate } from './pickerValues';

function clamp(date, earliest, latest) {
  if (isBefore(date, earliest)) return earliest;
  if (isAfter(date, latest)) return latest;
  return date;
}

/**
 * A date with a calendar. The field shows the date as "Sat, 12 Dec 2026"; a click (or ↓) opens the calendar, and the
 * date can also be typed: 12/12/2026 (day first), 2026-12-12 or 12 Dec 2026. Works with react-hook-form through
 * `Controller` (`<Controller render={({ field }) => <DateField {...field} … />} />`).
 *
 * Keyboard: ↓ or Alt+↓ opens the calendar and moves into it, arrows move by day, Page Up/Down by month, Enter
 * chooses, Escape closes and returns to the field.
 */
export const DateField = forwardRef(function DateField(
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
    min,
    max,
    disabled = false,
    placeholder = 'DD/MM/YYYY',
    rangeStart,
    rangeEnd,
    months = 1,
    captionLayout,
    clearable = optional ?? false,
    className,
    'aria-invalid': ariaInvalid,
    'aria-describedby': extraDescription,
  },
  ref,
) {
  const invalid = Boolean(error) || Boolean(ariaInvalid);
  const ids = useFieldIds(id);
  const panelId = `${ids.controlId}-calendar`;
  const inputRef = useRef(null);
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  // What is being typed right now; null shows the chosen date.
  const [typed, setTyped] = useState(null);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [hovered, setHovered] = useState();
  const [Calendar, setCalendar] = useState(loadedCalendar);
  const wide = useMediaQuery('(min-width: 640px)');
  // Touch screens: no on-screen keyboard over the calendar (a hardware keyboard still types).
  const coarsePointer = useMediaQuery('(pointer: coarse)');

  const iso = value ?? '';
  const selected = isoToDate(iso);
  const minDate = isoToDate(min);
  const maxDate = isoToDate(max);
  const today = startOfToday();
  const startMonth = minDate ?? startOfYear(subYears(today, 100));
  const endMonth = maxDate ?? endOfYear(addYears(today, 10));
  const shownMonths = wide ? months : 1;
  const layout = captionLayout ?? (months === 2 ? 'label' : 'dropdown');
  const todayAllowed = (!minDate || !isBefore(today, minDate)) && (!maxDate || !isAfter(today, maxDate));
  const disabledDays = [...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])];

  // The stay or trip this date belongs to; while choosing an end day, the hovered day previews it.
  let rangeFrom;
  let rangeTo;
  if (rangeStart !== undefined) {
    rangeFrom = isoToDate(rangeStart);
    rangeTo = open && hovered && rangeFrom && isAfter(hovered, rangeFrom) ? hovered : selected;
  } else if (rangeEnd !== undefined) {
    rangeFrom = selected;
    rangeTo = isoToDate(rangeEnd);
  }
  const rangeModifiers =
    rangeFrom && rangeTo && isBefore(rangeFrom, rangeTo)
      ? {
          rangeStart: rangeFrom,
          rangeEnd: rangeTo,
          rangeMiddle: { after: rangeFrom, before: rangeTo },
        }
      : undefined;

  useEffect(() => {
    if (!open || focusRequest === 0 || !Calendar) return;
    // DayPicker's roving focus target: the chosen day, else today, else the first day that can be chosen.
    panelRef.current?.querySelector('[role="grid"] button[tabindex="0"]')?.focus();
  }, [open, focusRequest, Calendar]);

  /** Starts loading the calendar on the first sign of interest (pointer over the field, focus, opening). */
  const prepareCalendar = () => {
    if (!Calendar) void loadCalendar().then((loaded) => setCalendar(() => loaded));
  };

  const openCalendar = (moveFocus) => {
    if (disabled) return;
    prepareCalendar();
    if (!open) {
      // Two months side by side: an end day in the month after the start opens on the start's month, so the whole
      // stay or trip is in view.
      const start = isoToDate(rangeStart);
      const showStart = start && selected && shownMonths === 2 && differenceInCalendarMonths(selected, start) === 1;
      setMonth(startOfMonth(clamp(showStart ? start : (selected ?? start ?? today), startMonth, endMonth)));
      setOpen(true);
    }
    if (moveFocus) setFocusRequest((request) => request + 1);
  };

  const close = (returnFocus) => {
    setOpen(false);
    setHovered(undefined);
    if (returnFocus) inputRef.current?.focus();
  };

  const commit = (next) => {
    setTyped(null);
    if (next !== iso) onChange(next);
  };

  const choose = (date) => {
    if (!date) return;
    commit(dateToIso(date));
    close(true);
  };

  const onType = (event) => {
    const text = event.target.value;
    setTyped(text);
    if (text.trim() === '') {
      if (iso !== '') onChange('');
      return;
    }
    const parsed = parseTypedDate(text);
    if (parsed !== null) {
      if (parsed !== iso) onChange(parsed);
      const date = isoToDate(parsed);
      if (date) setMonth(startOfMonth(clamp(date, startMonth, endMonth)));
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openCalendar(true);
    } else if (event.key === 'Escape' && open) {
      // Only the calendar closes, not a dialog around the field.
      event.preventDefault();
      event.stopPropagation();
      setTyped(null);
      close(false);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      setTyped(null);
      close(false);
    } else if (event.key === 'Tab' && open) {
      // Tab goes on to the next field, not into the calendar (↓ does that).
      close(false);
    }
  };

  const onPanelKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  // Focus left the field and its calendar.
  const onWrapperBlur = (event) => {
    const next = event.relatedTarget;
    if (next && event.currentTarget.contains(next)) return;
    setTyped(null);
    if (open) close(false);
    onBlur?.();
  };

  const footer = todayAllowed || (clearable && iso !== '');

  return (
    <FieldChrome {...ids} label={label} hint={hint} error={error} optional={optional}>
      <div
        ref={anchorRef}
        className="relative"
        onBlur={onWrapperBlur}
        onPointerEnter={prepareCalendar}
        onFocus={prepareCalendar}
      >
        <CalendarDays
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-role-600"
          aria-hidden="true"
        />
        <input
          ref={(node) => {
            inputRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          id={ids.controlId}
          type="text"
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={
            [describedBy(error, hint, ids.hintId, ids.errorId), extraDescription].filter(Boolean).join(' ') || undefined
          }
          autoComplete="off"
          spellCheck={false}
          inputMode={coarsePointer ? 'none' : undefined}
          placeholder={placeholder}
          disabled={disabled}
          value={typed ?? formatFieldDate(iso)}
          data-value={iso}
          onChange={onType}
          onClick={() => openCalendar(false)}
          onKeyDown={onKeyDown}
          className={cn(controlClass(invalid), 'cursor-pointer pl-10 pr-9 font-medium', className)}
        />
        <ChevronDown
          className={cn(
            'pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 transition-transform duration-(--duration-base) ease-out-soft',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
        {name && <input type="hidden" name={name} value={iso} />}
        {open && (
          <FloatingPanel
            ref={panelRef}
            id={panelId}
            anchor={anchorRef}
            onDismiss={() => close(false)}
            role="dialog"
            // Its own name, so the field's label names only the field (getByLabelText finds one element).
            aria-label="Choose date"
            onKeyDown={onPanelKeyDown}
            className="p-1.5"
          >
            {Calendar ? (
              <Calendar
                mode="single"
                required
                selected={selected}
                onSelect={choose}
                month={month}
                onMonthChange={setMonth}
                startMonth={startMonth}
                endMonth={endMonth}
                captionLayout={layout}
                numberOfMonths={shownMonths}
                // Two months side by side: no days of the neighbouring month (they would show twice).
                showOutsideDays={shownMonths === 1}
                disabled={disabledDays}
                modifiers={rangeModifiers}
                onDayMouseEnter={(date, modifiers) => setHovered(modifiers.disabled ? undefined : date)}
                onDayMouseLeave={() => setHovered(undefined)}
              />
            ) : (
              <div
                role="status"
                className="flex h-72 w-72 max-w-full items-center justify-center gap-2 text-sm text-slate-500"
              >
                <Loader2 className="size-5 animate-spin text-role-600" aria-hidden="true" />
                Loading calendar…
              </div>
            )}
            {footer && (
              <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-100 px-1.5 pt-2">
                {todayAllowed ? (
                  <button
                    type="button"
                    onClick={() => choose(today)}
                    className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-role-700 transition-colors hover:bg-role-50"
                  >
                    Today
                  </button>
                ) : (
                  <span />
                )}
                {clearable && iso !== '' && (
                  <button
                    type="button"
                    onClick={() => {
                      commit('');
                      close(true);
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </FloatingPanel>
        )}
      </div>
    </FieldChrome>
  );
});
