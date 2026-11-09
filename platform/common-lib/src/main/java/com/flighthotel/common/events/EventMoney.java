package com.flighthotel.common.events;

import java.math.BigDecimal;
import java.math.RoundingMode;

import com.flighthotel.events.common.Money;

/**
 * Converts between {@link BigDecimal} amounts and the Avro {@link Money} record.
 * <p>
 * Avro's decimal type has a FIXED scale (2 for money): an amount like {@code 1499} or {@code 1499.5} must be
 * rescaled to {@code 1499.00} / {@code 1499.50} first, otherwise serialization fails. Always build events through
 * this class.
 */
public final class EventMoney {

    private EventMoney() {
    }

    public static Money of(BigDecimal amount, String currency) {
        if (amount == null || currency == null) {
            throw new IllegalArgumentException("amount and currency are required");
        }
        return Money.newBuilder()
                .setAmount(scale(amount))
                .setCurrency(currency)
                .build();
    }

    /** The amount with scale 2, as stored in DECIMAL(12,2) columns. */
    public static BigDecimal amount(Money money) {
        return scale(money.getAmount());
    }

    public static BigDecimal scale(BigDecimal amount) {
        return amount.setScale(2, RoundingMode.HALF_UP);
    }
}
