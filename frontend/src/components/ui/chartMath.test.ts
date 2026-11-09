import { chartSummary, niceScale } from './chartMath';

// Moved from Chart.test.tsx when the old SVG Chart component was retired (Phase 11): the chart kit still uses chartMath.
const days = ['1 Nov', '2 Nov', '3 Nov'];

describe('niceScale', () => {
  it('rounds the top to a clean step and always includes zero', () => {
    expect(niceScale(0, 87)).toEqual({ min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100] });
    expect(niceScale(0, 0)).toEqual({ min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] });
  });

  it('uses whole steps for counts and goes below zero for negative values', () => {
    expect(niceScale(0, 3, { integer: true }).ticks).toEqual([0, 1, 2, 3]);
    expect(niceScale(-1500, 4200).ticks).toEqual([-2000, -1000, 0, 1000, 2000, 3000, 4000, 5000]);
  });
});

describe('chartSummary', () => {
  it('names the period, the total and the highest day of every series', () => {
    expect(chartSummary('Bookings per day', days, [{ label: 'Flights', values: [1, 4, 2] }, { label: 'Hotels', values: [0, 0, 3] }]))
      .toBe('Bookings per day, 1 Nov to 3 Nov. Flights: 7 in total, highest 4 on 2 Nov. Hotels: 3 in total, highest 3 on 3 Nov.');
  });

  it('says when there is nothing to show', () => {
    expect(chartSummary('Revenue per day', [], [])).toBe('Revenue per day: no data.');
  });
});
