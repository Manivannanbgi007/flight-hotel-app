import { DEFAULT_RANGE, readRange, rangeProblem, writeRange } from './dateRange';
import { normalizeOccupancy, normalizeRevenue, rangeParams } from './operationsApi';
import { day } from './opsTestData';
import { reservationActions } from './reservationStatus';
import { valueAxis } from './reportScale';

describe('date range in the URL', () => {
  const read = (query: string) => readRange(new URLSearchParams(query));

  it('defaults to the last 30 days and ignores unknown presets', () => {
    expect(read('')).toEqual(DEFAULT_RANGE);
    expect(read('range=NEXT_YEAR')).toEqual({ range: 'LAST_30_DAYS' });
    expect(read('range=PREVIOUS_MONTH')).toEqual({ range: 'PREVIOUS_MONTH' });
  });

  it('reads custom dates only when they make a valid range', () => {
    expect(read('range=CUSTOM&from=2026-10-01&to=2026-10-31')).toEqual({ range: 'CUSTOM', from: '2026-10-01', to: '2026-10-31' });
    expect(read('range=CUSTOM&from=2026-10-31&to=2026-10-01')).toEqual(DEFAULT_RANGE);
    expect(read('range=CUSTOM&from=2026-13-01&to=2026-10-01')).toEqual(DEFAULT_RANGE);
    expect(read('range=CUSTOM')).toEqual(DEFAULT_RANGE);
  });

  it('writes the range, keeps other parameters and leaves the default out', () => {
    const params = new URLSearchParams('report=revenue&from=2026-01-01&to=2026-01-02&range=CUSTOM');
    expect(writeRange(params, { range: 'LAST_7_DAYS' }).toString()).toBe('report=revenue&range=LAST_7_DAYS');
    expect(writeRange(params, DEFAULT_RANGE).toString()).toBe('report=revenue');
    expect(writeRange(new URLSearchParams(), { range: 'CUSTOM', from: '2026-10-01', to: '2026-10-02' }).toString())
      .toBe('range=CUSTOM&from=2026-10-01&to=2026-10-02');
  });

  it('allows at most 366 days, both dates included', () => {
    expect(rangeProblem('2024-01-01', '2024-12-31')).toBeNull(); // 366 days (leap year)
    expect(rangeProblem('2025-01-01', '2026-01-02')).toBe('Choose at most 366 days');
    expect(rangeProblem('2026-10-01', '2026-10-01')).toBeNull();
    expect(rangeProblem('', '2026-10-01')).toBe('Choose a start and an end date');
  });

  it('sends from and to only for custom ranges', () => {
    expect(rangeParams({ range: 'TODAY', from: '2026-01-01', to: '2026-01-02' })).toEqual({ range: 'TODAY' });
    expect(rangeParams({ range: 'CUSTOM', from: '2026-01-01', to: '2026-01-02' })).toEqual({ range: 'CUSTOM', from: '2026-01-01', to: '2026-01-02' });
  });
});

describe('reservation actions', () => {
  const stay = (status: Parameters<typeof reservationActions>[0]['status'], checkInOffset: number, nights = 2) =>
    reservationActions({ status, checkIn: day(checkInOffset), checkOut: day(checkInOffset + nights) });

  it('a confirmed stay that starts later: only the hotel cancellation, and when check-in opens', () => {
    expect(stay('CONFIRMED', 2)).toEqual({ checkIn: false, checkOut: false, noShow: false, cancel: true, checkInOpensOn: day(2) });
  });

  it('on the check-in day: check in or cancel', () => {
    expect(stay('CONFIRMED', 0)).toMatchObject({ checkIn: true, noShow: false, cancel: true, checkInOpensOn: null });
  });

  it('from the day after check-in: check in (until check-out) or no-show', () => {
    expect(stay('CONFIRMED', -1)).toMatchObject({ checkIn: true, noShow: true, cancel: false });
    expect(stay('CONFIRMED', -2)).toMatchObject({ checkIn: false, noShow: true, cancel: false });
  });

  it('a guest in house can check out, even early', () => {
    expect(stay('CHECKED_IN', -1, 5)).toEqual({ checkIn: false, checkOut: true, noShow: false, cancel: false, checkInOpensOn: null });
  });

  it.each(['HELD', 'CHECKED_OUT', 'NO_SHOW', 'CANCELLED', 'EXPIRED', 'RELEASED'] as const)('%s: nothing to do', (status) => {
    expect(stay(status, 0)).toEqual({ checkIn: false, checkOut: false, noShow: false, cancel: false, checkInOpensOn: null });
  });
});

describe('report answers', () => {
  const night = { date: '2026-10-30', roomNights: 20, bookedRoomNights: 15, occupancyPercent: 75 };

  it('reads the nights under any of the likely names', () => {
    expect(normalizeOccupancy({ nights: [night] }).rows).toEqual([night]);
    expect(normalizeOccupancy({ rows: [night] }).rows).toEqual([night]);
    expect(normalizeOccupancy({ days: [night] }).rows).toEqual([night]);
    expect(normalizeOccupancy({ content: [night] }).rows).toEqual([night]);
    expect(normalizeOccupancy({}).rows).toEqual([]);
  });

  it('keeps the server\'s totals and works out missing ones from the nights', () => {
    const second = { ...night, date: '2026-10-31', bookedRoomNights: 19, occupancyPercent: 95 };
    expect(normalizeOccupancy({ nights: [night, second] }).totals).toEqual({ roomNights: 40, bookedRoomNights: 34, occupancyPercent: 85 });
    expect(normalizeOccupancy({ nights: [night], totals: { roomNights: 1, bookedRoomNights: 1, occupancyPercent: 100 } }).totals)
      .toEqual({ roomNights: 1, bookedRoomNights: 1, occupancyPercent: 100 });
    expect(normalizeRevenue({ rows: [
      { date: '2026-10-30', roomNights: 2, revenue: 10000, averageDailyRate: 5000 },
      { date: '2026-10-31', roomNights: 1, revenue: 6000, averageDailyRate: 6000 },
    ] }).totals).toEqual({ roomNights: 3, revenue: 16000, averageDailyRate: 5333.33 });
  });
});

describe('chart axis', () => {
  it('uses clean steps up to the largest value', () => {
    expect(valueAxis(104500)).toEqual({ max: 150000, ticks: [0, 50000, 100000, 150000] });
    expect(valueAxis(8000)).toEqual({ max: 8000, ticks: [0, 2000, 4000, 6000, 8000] });
    expect(valueAxis(0)).toEqual({ max: 1, ticks: [0, 1] });
  });
});
