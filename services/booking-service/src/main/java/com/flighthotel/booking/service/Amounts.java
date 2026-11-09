package com.flighthotel.booking.service;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.util.Currency;
import java.util.Locale;

import com.flighthotel.common.text.IndianDigits;

/** Amounts in customer-facing texts: "₹2,00,000" / "₹1,499.50" (Indian grouping). */
public final class Amounts {

    private static final Locale INDIA = Locale.of("en", "IN");

    private Amounts() {
    }

    public static String format(BigDecimal amount, String currency) {
        NumberFormat format = NumberFormat.getCurrencyInstance(INDIA);
        format.setCurrency(Currency.getInstance(currency));
        boolean whole = amount.stripTrailingZeros().scale() <= 0;
        format.setMinimumFractionDigits(whole ? 0 : 2);
        format.setMaximumFractionDigits(whole ? 0 : 2);
        // The JDK groups en-IN like en-US (200,000); Indian grouping is added here.
        format.setGroupingUsed(false);
        return IndianDigits.group(format.format(amount));
    }
}
