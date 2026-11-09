import {
  dateToIso,
  formatFieldDate,
  formatTime12h,
  isCompleteTime,
  isoToDate,
  labelDay,
  minutesToTime,
  parseTypedDate,
  parseTypedTime,
  timeToMinutes,
} from './pickerValues';

describe('date values', () => {
  it('reads an ISO date as a local day and refuses days that do not exist', () => {
    const date = isoToDate('2026-12-12');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(11);
    expect(date?.getDate()).toBe(12);
    expect(date?.getHours()).toBe(0);
    expect(isoToDate('2026-02-30')).toBeUndefined();
    expect(isoToDate('2026-13-01')).toBeUndefined();
    expect(isoToDate('12/12/2026')).toBeUndefined();
    expect(isoToDate('')).toBeUndefined();
    expect(isoToDate(null)).toBeUndefined();
    expect(dateToIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('shows a date with its weekday', () => {
    expect(formatFieldDate('2026-12-12')).toBe('Sat, 12 Dec 2026');
    expect(formatFieldDate('')).toBe('');
    expect(formatFieldDate('not a date')).toBe('');
  });

  it.each([
    ['2026-12-12', '2026-12-12'],
    ['12/12/2026', '2026-12-12'],
    ['4/12/2026', '2026-12-04'],
    ['04-12-2026', '2026-12-04'],
    ['04.12.2026', '2026-12-04'],
    ['4 Dec 2026', '2026-12-04'],
    ['4 december 2026', '2026-12-04'],
    ['Dec 4, 2026', '2026-12-04'],
    ['  4   Dec   2026 ', '2026-12-04'],
    // The field's own text: the weekday is ignored, the day counts.
    ['Sat, 12 Dec 2026', '2026-12-12'],
    ['Mon, 13 Dec 2026', '2026-12-13'],
  ])('reads the typed date %j', (typed, iso) => {
    expect(parseTypedDate(typed)).toBe(iso);
  });

  it.each(['', '2026-12', '12/12/26', '12/12/202', '31/02/2026', '2026-12-1x', 'tomorrow', '12/12/20261'])(
    'waits for a whole, real date instead of guessing from %j',
    (typed) => {
      expect(parseTypedDate(typed)).toBeNull();
    },
  );
});

describe('day names', () => {
  it('start with the number the day button shows (label in name), then today and selected', () => {
    const day = new Date(2026, 11, 12);
    expect(labelDay(day)).toBe('12 December 2026, Saturday');
    expect(labelDay(day, { today: true, selected: true } as never)).toBe('12 December 2026, Saturday, today, selected');
  });
});

describe('time values', () => {
  it.each([
    ['14:30', '14:30'],
    ['1430', '14:30'],
    ['930', '09:30'],
    ['9', '09:00'],
    ['9.15', '09:15'],
    ['2pm', '14:00'],
    ['2:30 PM', '14:30'],
    ['2:30 p.m.', '14:30'],
    ['12 am', '00:00'],
    ['12:15 pm', '12:15'],
    ['00:00', '00:00'],
  ])('reads the typed time %j', (typed, time) => {
    expect(parseTypedTime(typed)).toBe(time);
  });

  it.each(['', '24:00', '14:60', '14:', '13pm', '0am', 'noon', '2m'])('refuses %j', (typed) => {
    expect(parseTypedTime(typed)).toBeNull();
  });

  it('knows when typed time text is finished (the field waits for "1" to become "11:30")', () => {
    for (const done of ['14:30', '1430', '9.15', '2pm', '2 p.m.', '9 am']) expect(isCompleteTime(done)).toBe(true);
    for (const unfinished of ['1', '14', '143', '14:3', '']) expect(isCompleteTime(unfinished)).toBe(false);
  });

  it('converts between times and minutes and shows the 12-hour form', () => {
    expect(timeToMinutes('14:30')).toBe(870);
    expect(timeToMinutes('2:30')).toBeNaN();
    expect(timeToMinutes(undefined)).toBeNaN();
    expect(minutesToTime(870)).toBe('14:30');
    expect(minutesToTime(0)).toBe('00:00');
    expect(formatTime12h('00:30')).toBe('12:30 AM');
    expect(formatTime12h('12:00')).toBe('12:00 PM');
    expect(formatTime12h('14:30')).toBe('2:30 PM');
    expect(formatTime12h('nope')).toBe('');
  });
});
