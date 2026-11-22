let loaded = null;
let loading = null;

/**
 * The calendar (react-day-picker, about 40 KB) is loaded on first use, so it stays out of the first page load. A date
 * field starts loading it when the pointer reaches it or it gets focus, usually well before the click that opens it.
 */
export function loadCalendar() {
  loading ??= import('./Calendar').then((module) => {
    loaded = module.Calendar;
    return loaded;
  });
  return loading;
}

/** The calendar if it has been loaded already (then a date field renders it at once). */
export function loadedCalendar() {
  return loaded;
}
