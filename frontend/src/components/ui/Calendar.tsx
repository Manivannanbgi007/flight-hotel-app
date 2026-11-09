import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import {
  DayPicker,
  type ChevronProps,
  type ClassNames,
  type DayPickerProps,
  type DropdownProps,
} from 'react-day-picker';

import { cn } from '@/lib/cn';
import { selectClass } from './fieldStyles';
import { labelDay } from './pickerValues';

/** Each day is a 40 px circle; its cell (`group/day`) carries DayPicker's data-selected, data-today, ... flags. */
const DAY_BUTTON = cn(
  'relative mx-auto flex size-10 items-center justify-center rounded-full text-sm font-medium tabular-nums text-slate-800',
  'transition-[background-color,color,box-shadow] duration-(--duration-fast) ease-out-soft hover:bg-slate-100',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-role-600',
  // Days of the next or previous month: lighter, but still 4.5:1 on white.
  'group-data-outside/day:text-slate-500',
  'group-data-today/day:font-bold group-data-today/day:text-role-700 group-data-today/day:ring-1 group-data-today/day:ring-inset group-data-today/day:ring-role-300',
  // A shaded stay or trip (DateField's rangeStart / rangeEnd).
  'group-[.cal-range-middle]/day:text-role-900 group-[.cal-range-middle]/day:hover:bg-role-200',
  'group-[.cal-range-start]/day:bg-role-600 group-[.cal-range-start]/day:text-white group-[.cal-range-start]/day:ring-0 group-[.cal-range-start]/day:hover:bg-role-700',
  'group-[.cal-range-end]/day:bg-role-600 group-[.cal-range-end]/day:text-white group-[.cal-range-end]/day:ring-0 group-[.cal-range-end]/day:hover:bg-role-700',
  'group-data-selected/day:bg-role-600 group-data-selected/day:font-semibold group-data-selected/day:text-white group-data-selected/day:shadow-md group-data-selected/day:ring-0 group-data-selected/day:hover:bg-role-700',
  'disabled:cursor-not-allowed disabled:font-normal disabled:text-slate-300 disabled:line-through disabled:decoration-slate-300 disabled:hover:bg-transparent',
);

const NAV_BUTTON = cn(
  'pointer-events-auto inline-flex size-9 items-center justify-center rounded-xl text-slate-600',
  'transition-colors duration-(--duration-fast) hover:bg-slate-100 hover:text-slate-900',
  'aria-disabled:pointer-events-none aria-disabled:opacity-30',
);

const CLASS_NAMES: Partial<ClassNames> = {
  root: 'relative select-none p-1.5',
  months: 'relative flex flex-col gap-5 sm:flex-row sm:gap-7',
  month: 'flex flex-col gap-2',
  month_caption: 'flex h-9 items-center justify-center px-10',
  caption_label: 'text-sm font-bold text-slate-900',
  dropdowns: 'flex items-center gap-1.5',
  nav: 'pointer-events-none absolute inset-x-1.5 top-1.5 z-10 flex h-9 items-center justify-between',
  button_previous: NAV_BUTTON,
  button_next: NAV_BUTTON,
  chevron: '',
  month_grid: 'border-collapse',
  weekdays: '',
  weekday: 'h-8 w-10 p-0 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500',
  week: '',
  day: 'group/day size-10 p-0 text-center',
  day_button: DAY_BUTTON,
  hidden: 'invisible',
  footer: '',
};

/** Shading of a stay or trip; the end days get a half band so the band joins their circles. */
const MODIFIER_CLASS_NAMES = {
  rangeStart: 'cal-range-start bg-[linear-gradient(90deg,transparent_50%,var(--role-100)_50%)]',
  rangeMiddle: 'cal-range-middle bg-role-100',
  rangeEnd: 'cal-range-end bg-[linear-gradient(90deg,var(--role-100)_50%,transparent_50%)]',
};

function CalendarChevron({ orientation = 'left', className }: ChevronProps) {
  const Icon = { left: ChevronLeft, right: ChevronRight, up: ChevronUp, down: ChevronDown }[orientation];
  return <Icon className={cn('size-4', className)} aria-hidden="true" />;
}

/** Month and year menus: our select (so they look like every other menu in the app). */
function CalendarDropdown({ options, className: _defaultClass, ...props }: DropdownProps) {
  return (
    <select {...props} className={cn(selectClass(false, { inline: true, size: 'sm' }), 'font-semibold')}>
      {options?.map(({ value, label, disabled }) => (
        <option key={value} value={value} disabled={disabled}>
          {label}
        </option>
      ))}
    </select>
  );
}

/**
 * DayPicker (react-day-picker) in our look: round days, the portal's accent for the chosen day, today ringed, days
 * that cannot be chosen struck through, and our selects for the month and year menus. Weeks start on Monday.
 * Keyboard: arrows move by day and week, Page Up/Down by month, Home/End to the week's ends, Enter chooses.
 */
export function Calendar({ classNames, components, modifiersClassNames, labels, ...props }: DayPickerProps) {
  return (
    <DayPicker
      weekStartsOn={1}
      showOutsideDays
      labels={{ labelDayButton: labelDay, ...labels }}
      classNames={{ ...CLASS_NAMES, ...classNames }}
      modifiersClassNames={{ ...MODIFIER_CLASS_NAMES, ...modifiersClassNames }}
      components={{ Chevron: CalendarChevron, Dropdown: CalendarDropdown, ...components }}
      {...props}
    />
  );
}
