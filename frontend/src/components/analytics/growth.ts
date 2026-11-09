import type { StatChange } from '@/components/ui/StatCard';

/**
 * A figure against the previous period (api-analytics §0.4): `change` = current − previous (percentage points for a
 * rate), `changePercent` = change / |previous| × 100, **null when previous is 0 and current is not**, `trend` by the
 * sign of `change`.
 */
export interface Change {
  current: number;
  previous: number;
  change: number;
  changePercent: number | null;
  trend: 'UP' | 'DOWN' | 'FLAT';
}

/** `amount`: counts and money (relative change in %); `rate`: a percentage (change in percentage points). */
export type ChangeKind = 'amount' | 'rate';

const percent = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const points = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

/** Rounds to one decimal (the API's precision), so 2.0999999 reads 2.1 and −0.04 is no change. */
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/**
 * The API's Change as the StatCard / TrendChip change:
 * - a rate → its change in percentage points ("+2.1 pp");
 * - `changePercent: null` with something now → "New" (the previous period had none), never ∞ or NaN;
 * - no Change at all (e.g. no answered ticket in one of the periods) → `undefined`: the card shows no chip.
 */
export function toStatChange(
  change: Change | null | undefined,
  { kind = 'amount', upIsGood = true, period = 'vs previous period' }: { kind?: ChangeKind; upIsGood?: boolean; period?: string } = {},
): StatChange | undefined {
  if (!change) return undefined;
  if (kind === 'rate') {
    return finite(change.change) ? { percent: oneDecimal(change.change), unit: 'points', upIsGood, period } : undefined;
  }
  if (!finite(change.changePercent)) {
    // previous was 0: "New" when there is something now, otherwise simply no change.
    return finite(change.current) && change.current !== 0
      ? { percent: null, isNew: true, upIsGood, period }
      : { percent: 0, upIsGood, period };
  }
  return { percent: oneDecimal(change.changePercent), upIsGood, period };
}

/**
 * The change as plain text (tables, tests, summaries): "+25%", "−3.5%", "No change", "New", "+2.1 pp", "−0.4 pp"
 * or "–" when there is nothing to compare.
 */
export function formatGrowth(change: Change | null | undefined, kind: ChangeKind = 'amount'): string {
  if (!change) return '–';
  if (kind === 'rate') {
    if (!finite(change.change)) return '–';
    const value = oneDecimal(change.change);
    return value === 0 ? 'No change' : `${value > 0 ? '+' : '−'}${points.format(Math.abs(value))} pp`;
  }
  if (!finite(change.changePercent)) {
    return finite(change.current) && change.current !== 0 ? 'New' : 'No change';
  }
  const value = oneDecimal(change.changePercent);
  return value === 0 ? 'No change' : `${value > 0 ? '+' : '−'}${percent.format(Math.abs(value))}%`;
}

/**
 * A rate's change worked out from the counts of both periods, for a rate the API compares only as counts (the payment
 * success rate: successful / (successful + failed)). Null when the previous period had no attempts.
 */
export function rateChange(
  successful: Change | null | undefined,
  failed: Change | null | undefined,
  currentRate: number,
): Change | null {
  if (!successful || !failed) return null;
  const previousTotal = successful.previous + failed.previous;
  if (!finite(previousTotal) || previousTotal <= 0) return null;
  const previous = oneDecimal((successful.previous / previousTotal) * 100);
  const change = oneDecimal(currentRate - previous);
  return {
    current: currentRate,
    previous,
    change,
    changePercent: previous === 0 ? null : oneDecimal((change / Math.abs(previous)) * 100),
    trend: change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'FLAT',
  };
}
