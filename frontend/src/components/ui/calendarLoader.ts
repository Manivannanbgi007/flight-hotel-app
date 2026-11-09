import type { Calendar as CalendarComponent } from './Calendar';

export type CalendarType = typeof CalendarComponent;

let loaded: CalendarType | null = null;
let loading: Promise<CalendarType> | null = null;

/**
 * The calendar (react-day-picker, about 40 KB) is loaded on first use, so it stays out of the first page load. A date
 * field starts loading it when the pointer reaches it or it gets focus, usually well before the click that opens it.
 */
export function loadCalendar(): Promise<CalendarType> {
  loading ??= import('./Calendar').then((module) => {
    loaded = module.Calendar;
    return loaded;
  });
  return loading;
}

/** The calendar if it has been loaded already (then a date field renders it at once). */
export function loadedCalendar(): CalendarType | null {
  return loaded;
}
