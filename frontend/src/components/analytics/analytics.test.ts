import { formatGrowth, rateChange, toStatChange, type Change } from './growth';
import {
  analyticsApiParams,
  analyticsSearchParams,
  autoInterval,
  categoryFormat,
  describeDays,
  indiaToday,
  intervalOptions,
  pointCount,
  presetDays,
  readAnalyticsQuery,
  validateAnalyticsDates,
  withRange,
} from './range';

const TODAY = '2026-11-06';
const change = (overrides: Partial<Change>): Change => ({ current: 0, previous: 0, change: 0, changePercent: 0, trend: 'FLAT', ...overrides });

describe('analytics ranges (api-analytics §0.2)', () => {
  it('turns every preset into India days, both ends included', () => {
    const days = (preset: Parameters<typeof presetDays>[0]['preset']) => presetDays({ preset, from: '', to: '' }, TODAY);
    expect(days('TODAY')).toEqual({ from: TODAY, to: TODAY });
    expect(days('LAST_7_DAYS')).toEqual({ from: '2026-10-31', to: TODAY });
    expect(days('LAST_30_DAYS')).toEqual({ from: '2026-10-08', to: TODAY });
    expect(days('LAST_90_DAYS')).toEqual({ from: '2026-08-09', to: TODAY });
    expect(days('THIS_MONTH')).toEqual({ from: '2026-11-01', to: TODAY });
    expect(days('PREVIOUS_MONTH')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(days('LAST_12_MONTHS')).toEqual({ from: '2025-12-01', to: TODAY });
    expect(days('THIS_YEAR')).toEqual({ from: '2026-01-01', to: TODAY });
    expect(days('PREVIOUS_YEAR')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(days('LAST_3_YEARS')).toEqual({ from: '2024-01-01', to: TODAY });
    expect(days('LAST_5_YEARS')).toEqual({ from: '2022-01-01', to: TODAY });
    expect(presetDays({ preset: 'PREVIOUS_MONTH', from: '', to: '' }, '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetDays({ preset: 'LAST_12_MONTHS', from: '', to: '' }, '2026-01-20')).toEqual({ from: '2025-02-01', to: '2026-01-20' });
  });

  it('knows today in India, not in the browser\'s zone', () => {
    // 20:00 UTC on 6 Nov is already 7 Nov in India (UTC+5:30).
    expect(indiaToday(new Date('2026-11-06T20:00:00Z'))).toBe('2026-11-07');
    expect(indiaToday(new Date('2026-11-06T18:00:00Z'))).toBe('2026-11-06');
  });

  it('checks custom dates: both needed, in order, at most five years', () => {
    expect(validateAnalyticsDates('', TODAY)).toBe('Choose a start and an end date.');
    expect(validateAnalyticsDates('2026-02-30', TODAY)).toBe('Choose a start and an end date.');
    expect(validateAnalyticsDates('2026-11-07', TODAY)).toBe('The start date must be on or before the end date.');
    expect(validateAnalyticsDates('2021-11-05', '2026-11-06')).toBe('Choose at most five years (1,827 days).');
    expect(validateAnalyticsDates('2021-11-06', '2026-11-06')).toBeNull();
  });
});

describe('analytics intervals (api-analytics §0.3)', () => {
  it('counts the points like the server: ISO weeks, calendar months and years, cut ends included', () => {
    expect(pointCount('2022-01-01', TODAY, 'DAY')).toBe(1771);
    expect(pointCount('2026-11-01', '2026-11-08', 'WEEK')).toBe(2); // Sunday 1 Nov, then Mon 2 – Sun 8
    expect(pointCount('2026-11-02', '2026-11-08', 'WEEK')).toBe(1);
    expect(pointCount('2025-12-01', TODAY, 'MONTH')).toBe(12);
    expect(pointCount('2022-01-01', TODAY, 'YEAR')).toBe(5);
  });

  it('predicts the server\'s own choice: ≤ 31 days DAY, ≤ 92 WEEK, ≤ 731 MONTH, else YEAR', () => {
    expect(autoInterval('2026-10-08', TODAY)).toBe('DAY');
    expect(autoInterval('2026-08-09', TODAY)).toBe('WEEK');
    expect(autoInterval('2026-01-01', TODAY)).toBe('MONTH');
    expect(autoInterval('2022-01-01', TODAY)).toBe('YEAR');
  });

  it('disables and explains the intervals the server would refuse', () => {
    const options = intervalOptions('2022-01-01', TODAY);
    expect(options.map((option) => [option.value, option.allowed])).toEqual([['DAY', false], ['WEEK', true], ['MONTH', true], ['YEAR', true]]);
    expect(options[0]?.reason).toBe('Day: this range has 1,771 days, at most 366 can be shown. Choose a longer interval.');
    expect(intervalOptions('2026-10-08', TODAY).every((option) => option.allowed)).toBe(true);
  });

  it('reads the URL, dropping broken ranges and refused intervals', () => {
    const read = (search: string) => readAnalyticsQuery(new URLSearchParams(search), TODAY);
    expect(read('')).toEqual({ preset: 'LAST_30_DAYS', from: '', to: '', interval: null });
    expect(read('range=this_year&interval=week')).toEqual({ preset: 'THIS_YEAR', from: '', to: '', interval: 'WEEK' });
    expect(read('range=LAST_5_YEARS&interval=DAY')).toEqual({ preset: 'LAST_5_YEARS', from: '', to: '', interval: null });
    expect(read('range=CUSTOM&from=2026-10-10&to=2026-10-01')).toEqual({ preset: 'LAST_30_DAYS', from: '', to: '', interval: null });
    expect(read('range=CUSTOM&from=2025-01-01&to=2026-12-31&interval=MONTH'))
      .toEqual({ preset: 'CUSTOM', from: '2025-01-01', to: '2026-12-31', interval: 'MONTH' });
    expect(read('range=SOMETHING&interval=HOUR')).toEqual({ preset: 'LAST_30_DAYS', from: '', to: '', interval: null });
  });

  it('writes the URL and the API parameters (the server chooses when no interval is set)', () => {
    expect(analyticsSearchParams({ preset: 'LAST_30_DAYS', from: '', to: '', interval: null })).toEqual({ range: null, from: null, to: null, interval: null });
    expect(analyticsSearchParams({ preset: 'CUSTOM', from: '2026-10-01', to: '2026-10-10', interval: 'DAY' }))
      .toEqual({ range: 'CUSTOM', from: '2026-10-01', to: '2026-10-10', interval: 'DAY' });
    expect(analyticsApiParams({ preset: 'THIS_YEAR', from: '', to: '', interval: null })).toEqual({ range: 'THIS_YEAR' });
    expect(analyticsApiParams({ preset: 'CUSTOM', from: '2026-10-01', to: '2026-10-10', interval: 'WEEK' }))
      .toEqual({ range: 'CUSTOM', from: '2026-10-01', to: '2026-10-10', interval: 'WEEK' });
  });

  it('keeps a chosen interval on a new range only when the server accepts it there', () => {
    const daily = { preset: 'LAST_30_DAYS' as const, from: '', to: '', interval: 'DAY' as const };
    expect(withRange(daily, { preset: 'LAST_90_DAYS', from: '', to: '' }, TODAY).interval).toBe('DAY');
    expect(withRange(daily, { preset: 'LAST_5_YEARS', from: '', to: '' }, TODAY).interval).toBeNull();
  });

  it('writes the days and the axis categories for the interval', () => {
    expect(describeDays({ from: '2026-10-08', to: TODAY })).toBe('8 Oct – 6 Nov 2026');
    expect(describeDays({ from: '2025-02-25', to: '2025-12-31' })).toBe('25 Feb – 31 Dec 2025');
    expect(describeDays({ from: '2025-12-01', to: TODAY })).toBe('1 Dec 2025 – 6 Nov 2026');
    expect(describeDays({ from: TODAY, to: TODAY })).toBe('6 Nov 2026');
    expect(categoryFormat('DAY', { from: '2026-10-08', to: TODAY })('2026-10-08')).toBe('8 Oct');
    expect(categoryFormat('WEEK', { from: '2025-12-01', to: TODAY })('2025-12-01')).toBe('1 Dec 25');
    expect(categoryFormat('MONTH')('2026-11-01')).toBe('Nov 2026');
    expect(categoryFormat('YEAR')('2022-01-01')).toBe('2022');
  });
});

describe('growth against the previous period (api-analytics §0.4)', () => {
  it('shows a relative change, rounded to one decimal, with the right colour meaning', () => {
    expect(toStatChange(change({ current: 1500, previous: 1200, change: 300, changePercent: 25, trend: 'UP' })))
      .toEqual({ percent: 25, upIsGood: true, period: 'vs previous period' });
    expect(toStatChange(change({ current: 2, previous: 3, change: -1, changePercent: -33.33333, trend: 'DOWN' }), { upIsGood: false }))
      .toEqual({ percent: -33.3, upIsGood: false, period: 'vs previous period' });
    expect(formatGrowth(change({ changePercent: 25, current: 5, previous: 4, change: 1 }))).toBe('+25%');
    expect(formatGrowth(change({ changePercent: -3.54, current: 1, previous: 2, change: -1 }))).toBe('−3.5%');
    expect(formatGrowth(change({ changePercent: 0, current: 0, previous: 0 }))).toBe('No change');
  });

  it('shows "New" — never ∞ or NaN — when the previous period had nothing (changePercent null)', () => {
    const fresh = change({ current: 620, previous: 0, change: 620, changePercent: null, trend: 'UP' });
    expect(toStatChange(fresh)).toEqual({ percent: null, isNew: true, upIsGood: true, period: 'vs previous period' });
    expect(formatGrowth(fresh)).toBe('New');
    expect(formatGrowth(change({ changePercent: Number.POSITIVE_INFINITY, current: 3 }))).toBe('New');
    expect(formatGrowth(change({ changePercent: Number.NaN, current: 0 }))).toBe('No change');
    expect(formatGrowth(null)).toBe('–');
    expect(toStatChange(null)).toBeUndefined();
  });

  it('shows the change of a rate in percentage points, also when the previous rate was 0', () => {
    const rate = change({ current: 3.5, previous: 0, change: 3.5, changePercent: null, trend: 'UP' });
    expect(toStatChange(rate, { kind: 'rate', upIsGood: false })).toEqual({ percent: 3.5, unit: 'points', upIsGood: false, period: 'vs previous period' });
    expect(formatGrowth(rate, 'rate')).toBe('+3.5 pp');
    expect(formatGrowth(change({ current: 4.1, previous: 6.2, change: -2.0999999, changePercent: -33.9, trend: 'DOWN' }), 'rate')).toBe('−2.1 pp');
    expect(formatGrowth(change({ current: 5, previous: 5 }), 'rate')).toBe('No change');
  });

  it('works out the payment success rate change from the counts of both periods', () => {
    const successful = change({ current: 621, previous: 98, change: 523, changePercent: 533.7, trend: 'UP' });
    const failed = change({ current: 2, previous: 2, change: 0, changePercent: 0, trend: 'FLAT' });
    expect(rateChange(successful, failed, 99.7)).toEqual({ current: 99.7, previous: 98, change: 1.7, changePercent: 1.7, trend: 'UP' });
    expect(rateChange(change({ current: 621 }), change({ current: 2 }), 99.7)).toBeNull();
  });
});
