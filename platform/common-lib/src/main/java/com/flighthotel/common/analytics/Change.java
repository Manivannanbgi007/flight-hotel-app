package com.flighthotel.common.analytics;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * A figure of this period against the same figure of the previous period of equal length.
 * <ul>
 * <li>{@code change} = current − previous (same unit as the figure; for a rate: percentage points);</li>
 * <li>{@code changePercent} = change / |previous| × 100, one decimal, half up; {@code null} when the previous value is
 * 0 and the current one is not (growth from nothing has no percentage); 0.0 when both are 0;</li>
 * <li>{@code trend} = UP, DOWN or FLAT by the sign of {@code change}.</li>
 * </ul>
 */
public record Change(BigDecimal current, BigDecimal previous, BigDecimal change, BigDecimal changePercent,
        Trend trend) {

    public enum Trend { UP, DOWN, FLAT }

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    public static Change of(BigDecimal current, BigDecimal previous) {
        BigDecimal now = current == null ? BigDecimal.ZERO : current;
        BigDecimal before = previous == null ? BigDecimal.ZERO : previous;
        BigDecimal change = now.subtract(before);
        BigDecimal percent;
        if (before.signum() == 0) {
            percent = change.signum() == 0 ? BigDecimal.ZERO.setScale(1) : null;
        } else {
            percent = change.multiply(HUNDRED).divide(before.abs(), 1, RoundingMode.HALF_UP);
        }
        Trend trend = change.signum() > 0 ? Trend.UP : change.signum() < 0 ? Trend.DOWN : Trend.FLAT;
        return new Change(now, before, change, percent, trend);
    }

    public static Change of(long current, long previous) {
        return of(BigDecimal.valueOf(current), BigDecimal.valueOf(previous));
    }

    /** part / whole × 100, one decimal, half up; 0.0 when whole is 0. */
    public static BigDecimal percent(long part, long whole) {
        return whole == 0 ? BigDecimal.ZERO.setScale(1)
                : BigDecimal.valueOf(part).multiply(HUNDRED).divide(BigDecimal.valueOf(whole), 1, RoundingMode.HALF_UP);
    }

    /** part / whole × 100 for amounts, one decimal, half up; 0.0 when whole is 0. */
    public static BigDecimal percent(BigDecimal part, BigDecimal whole) {
        return whole == null || whole.signum() == 0 ? BigDecimal.ZERO.setScale(1)
                : part.multiply(HUNDRED).divide(whole, 1, RoundingMode.HALF_UP);
    }
}
