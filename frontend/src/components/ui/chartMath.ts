/** Pure helpers of the SVG charts (Chart.tsx): colors, axis scale and the screen-reader summary. */

/** Categorical colors in fixed order (validated for color-blind separation on a white surface). */
export const CHART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const;

export interface ChartSeries {
  label: string;
  /** One value per category, in the same order. */
  values: number[];
  /** A level (customers registered so far), not an amount per point: the summary says where it starts and ends, never "in total". */
  level?: boolean;
}

const numberFormat = new Intl.NumberFormat('en-IN');
export const defaultFormat = (value: number) => numberFormat.format(value);

/** Round axis bounds and ticks (1, 2 or 5 × 10ⁿ) that include zero. */
export function niceScale(minValue: number, maxValue: number, { count = 4, integer = false } = {}) {
  let lo = Math.min(0, minValue);
  let hi = Math.max(0, maxValue);
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  let step = (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) * magnitude;
  if (integer) step = Math.max(1, Math.round(step));
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return { min: lo, max: hi, ticks };
}

/** "Bookings per day, 7 Oct to 13 Oct. Flights: 12 in total, highest 4 on 9 Oct. Hotels: …" */
export function chartSummary(title: string, categories: string[], series: ChartSeries[], format: (value: number) => string = defaultFormat): string {
  if (categories.length === 0) {
    return `${title}: no data.`;
  }
  const span = categories.length === 1 ? categories[0] : `${categories[0]} to ${categories[categories.length - 1]}`;
  const parts = series.map((s) => {
    if (s.level) {
      return `${s.label}: ${format(s.values[0] ?? 0)} at the start, ${format(s.values[s.values.length - 1] ?? 0)} at the end`;
    }
    const total = s.values.reduce((sum, value) => sum + value, 0);
    let peak = 0;
    s.values.forEach((value, index) => {
      if (value > (s.values[peak] ?? -Infinity)) peak = index;
    });
    return `${s.label}: ${format(total)} in total, highest ${format(s.values[peak] ?? 0)} on ${categories[peak]}`;
  });
  return `${title}, ${span}. ${parts.join('. ')}.`;
}

