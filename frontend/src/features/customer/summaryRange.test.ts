import {
  compareFigure,
  formatPeriod,
  isIsoDate,
  previousPeriod,
  rangeFromSearch,
  rangeToSearch,
  statChangeOf,
  validateCustomRange,
} from './summaryRange';

describe('compareFigure (contract §0.4)', () => {
  it('gives the change, the percentage with one decimal and the trend', () => {
    expect(compareFigure(1500, 1200)).toEqual({ current: 1500, previous: 1200, change: 300, changePercent: 25, trend: 'UP' });
    expect(compareFigure(2, 3)).toEqual({ current: 2, previous: 3, change: -1, changePercent: -33.3, trend: 'DOWN' });
    expect(compareFigure(7, 3).changePercent).toBe(133.3);
  });

  it('rounds half away from zero, like the server', () => {
    expect(compareFigure(10.45, 10).changePercent).toBe(4.5);
    expect(compareFigure(9.55, 10).changePercent).toBe(-4.5);
  });

  it('measures the change against the size of the previous figure (negative previous values too)', () => {
    expect(compareFigure(-50, -100)).toMatchObject({ change: 50, changePercent: 50, trend: 'UP' });
  });

  it('keeps money to paise', () => {
    expect(compareFigure(56450.5, 41450.25)).toMatchObject({ change: 15000.25, changePercent: 36.2 });
  });

  it('has no percentage when there was nothing before, and 0 when both are 0: never Infinity or NaN', () => {
    expect(compareFigure(620, 0)).toEqual({ current: 620, previous: 0, change: 620, changePercent: null, trend: 'UP' });
    expect(compareFigure(0, 0)).toEqual({ current: 0, previous: 0, change: 0, changePercent: 0, trend: 'FLAT' });
    expect(compareFigure(0, 4)).toMatchObject({ change: -4, changePercent: -100, trend: 'DOWN' });
  });
});

describe('statChangeOf', () => {
  it('shows the percentage with the period text and options', () => {
    expect(statChangeOf(compareFigure(3, 2), { period: 'vs previous period', neutral: true }))
      .toEqual({ percent: 50, period: 'vs previous period', neutral: true });
  });

  it('shows "New" when the previous period had nothing', () => {
    expect(statChangeOf(compareFigure(2, 0), { period: 'vs previous period' })).toEqual({ percent: null, isNew: true, period: 'vs previous period' });
  });

  it('shows nothing without a comparison or when both periods are empty', () => {
    expect(statChangeOf(null)).toBeUndefined();
    expect(statChangeOf(compareFigure(0, 0))).toBeUndefined();
  });
});

describe('previousPeriod', () => {
  it('is the same number of days right before the range', () => {
    expect(previousPeriod({ from: '2026-11-01', to: '2026-11-06' })).toEqual({ from: '2026-10-26', to: '2026-10-31' });
    // THIS_YEAR on 6 Nov 2026 (310 days), the contract's own example.
    expect(previousPeriod({ from: '2026-01-01', to: '2026-11-06' })).toEqual({ from: '2025-02-25', to: '2025-12-31' });
    // LAST_12_MONTHS: 1 Dec 2025 … 6 Nov 2026 (341 days).
    expect(previousPeriod({ from: '2025-12-01', to: '2026-11-06' })).toEqual({ from: '2024-12-25', to: '2025-11-30' });
  });

  it('handles one day and leap years', () => {
    expect(previousPeriod({ from: '2026-11-06', to: '2026-11-06' })).toEqual({ from: '2026-11-05', to: '2026-11-05' });
    // 365 days before 2025 (2024 has 366): a day count, not "the previous calendar year".
    expect(previousPeriod({ from: '2025-01-01', to: '2025-12-31' })).toEqual({ from: '2024-01-02', to: '2024-12-31' });
    expect(previousPeriod({ from: '2024-03-01', to: '2024-03-31' })).toEqual({ from: '2024-01-30', to: '2024-02-29' });
  });
});

describe('the period in the URL', () => {
  const parse = (query: string) => rangeFromSearch(new URLSearchParams(query));

  it('defaults to the last 12 months', () => {
    expect(parse('')).toEqual({ range: 'LAST_12_MONTHS' });
    expect(parse('range=NEXT_DECADE')).toEqual({ range: 'LAST_12_MONTHS' });
  });

  it('reads presets and valid custom ranges', () => {
    expect(parse('range=THIS_YEAR')).toEqual({ range: 'THIS_YEAR' });
    expect(parse('range=ALL_TIME&from=2020-01-01')).toEqual({ range: 'ALL_TIME' });
    expect(parse('range=CUSTOM&from=2025-01-01&to=2025-12-31')).toEqual({ range: 'CUSTOM', from: '2025-01-01', to: '2025-12-31' });
  });

  it('ignores invalid custom ranges', () => {
    expect(parse('range=CUSTOM&from=2025-01-01')).toEqual({ range: 'LAST_12_MONTHS' });
    expect(parse('range=CUSTOM&from=2025-12-31&to=2025-01-01')).toEqual({ range: 'LAST_12_MONTHS' });
    expect(parse('range=CUSTOM&from=2025-02-30&to=2025-03-01')).toEqual({ range: 'LAST_12_MONTHS' });
  });

  it('writes the period and keeps other parameters; the default leaves the URL clean', () => {
    const current = new URLSearchParams('range=CUSTOM&from=2025-01-01&to=2025-02-01&tab=x');
    expect(rangeToSearch({ range: 'LAST_12_MONTHS' }, current).toString()).toBe('tab=x');
    expect(rangeToSearch({ range: 'THIS_YEAR' }, current).toString()).toBe('tab=x&range=THIS_YEAR');
    expect(rangeToSearch({ range: 'CUSTOM', from: '2024-05-01', to: '2024-05-31' }).toString()).toBe('range=CUSTOM&from=2024-05-01&to=2024-05-31');
  });

  it('round-trips', () => {
    for (const params of [{ range: 'PREVIOUS_YEAR' as const }, { range: 'CUSTOM' as const, from: '2023-04-01', to: '2024-03-31' }]) {
      expect(rangeFromSearch(rangeToSearch(params))).toEqual(params);
    }
  });
});

describe('validateCustomRange', () => {
  it('accepts up to five years, both ends included', () => {
    expect(validateCustomRange('2025-01-01', '2025-01-01')).toBeNull();
    expect(validateCustomRange('2021-01-01', '2025-12-31')).toBeNull(); // 1,826 days
  });

  it('explains what is wrong', () => {
    expect(validateCustomRange('', '2025-01-01')).toBe('Choose both dates.');
    expect(validateCustomRange('2025-02-01', '2025-01-01')).toBe('The end date must be on or after the start date.');
    expect(validateCustomRange('2020-01-01', '2025-12-31')).toBe('Choose a period of at most five years.');
  });

  it('knows real calendar days', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2025-02-29')).toBe(false);
    expect(isIsoDate('2025-1-1')).toBe(false);
  });
});

describe('formatPeriod', () => {
  it('reads naturally', () => {
    expect(formatPeriod({ from: '2026-01-01', to: '2026-11-06' })).toBe('1 Jan – 6 Nov 2026');
    expect(formatPeriod({ from: '2025-12-01', to: '2026-11-06' })).toBe('1 Dec 2025 – 6 Nov 2026');
    expect(formatPeriod({ from: '2026-11-06', to: '2026-11-06' })).toBe('6 Nov 2026');
  });
});
