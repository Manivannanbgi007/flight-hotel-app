import { formatDate } from '@/lib/format';

/** Clean axis steps: 1, 2 or 5 × 10ⁿ, about four of them up to the largest value. */
export function valueAxis(largest: number, steps = 4): { max: number; ticks: number[] } {
  if (!(largest > 0)) return { max: 1, ticks: [0, 1] };
  const rough = largest / steps;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((f) => f * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude;
  const max = Math.ceil(largest / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= max + step / 2; tick += step) ticks.push(Math.round(tick * 100) / 100);
  return { max, ticks };
}

const compactMoney = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });

/** 150000 → "₹1.5L" (axis labels only; tables show full amounts). */
export function formatCompactMoney(value: number): string {
  return compactMoney.format(value);
}

/** "Highest 95% on 31 Oct 2026, lowest 10% on 8 Oct 2026." for the chart's text alternative. */
export function describeExtremes<Row extends { date: string }>(rows: Row[], value: (row: Row) => number, label: (row: Row) => string): string {
  if (rows.length === 0) return 'No nights in this period.';
  let high = rows[0]!;
  let low = rows[0]!;
  for (const row of rows) {
    if (value(row) > value(high)) high = row;
    if (value(row) < value(low)) low = row;
  }
  return `Highest ${label(high)} on ${formatDate(high.date)}, lowest ${label(low)} on ${formatDate(low.date)}.`;
}

/** The row with the highest value (the first of equal ones); undefined without rows. */
export function peakRow<Row>(rows: Row[], value: (row: Row) => number): Row | undefined {
  let peak: Row | undefined;
  for (const row of rows) {
    if (peak === undefined || value(row) > value(peak)) peak = row;
  }
  return peak;
}
