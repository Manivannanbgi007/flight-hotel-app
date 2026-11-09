import { formatHours, formatMinutes } from './durations';

describe('support durations', () => {
  it('reads minutes and hours as words, with a dash when there is no figure', () => {
    expect(formatMinutes(0)).toBe('Under 1 min');
    expect(formatMinutes(0.4)).toBe('Under 1 min');
    expect(formatMinutes(42.4)).toBe('42 min');
    expect(formatMinutes(95)).toBe('1 h 35 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(179.7)).toBe('3 h');
    expect(formatMinutes(36 * 60)).toBe('1.5 days');
    expect(formatMinutes(null)).toBe('–');
    expect(formatMinutes(Number.NaN)).toBe('–');
    expect(formatHours(26)).toBe('1.1 days');
    expect(formatHours(7.5)).toBe('7 h 30 min');
    expect(formatHours(null)).toBe('–');
  });
});
