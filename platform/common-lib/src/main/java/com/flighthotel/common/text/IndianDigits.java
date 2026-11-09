package com.flighthotel.common.text;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Indian digit grouping for amounts in texts, e-mails and PDFs: {@code 2,00,000} and {@code 1,23,45,678.90}, as the
 * frontend shows them ({@code Intl.NumberFormat('en-IN')}). The JDK cannot group this way: {@code DecimalFormat} has a
 * single grouping size, so the {@code en-IN} locale writes {@code 200,000}. Format without grouping first, then group
 * here.
 */
public final class IndianDigits {

    private static final Pattern DIGITS = Pattern.compile("\\d+");
    private static final Pattern PAIRS_FROM_THE_RIGHT = Pattern.compile("\\B(?=(\\d{2})+$)");

    private IndianDigits() {
    }

    /**
     * Groups the integer part of a number written without grouping ("₹200000.50", "-1234567"): the last three digits,
     * then pairs. Everything around it (currency symbol, sign, decimals) is kept as it is.
     */
    public static String group(String ungrouped) {
        Matcher integer = DIGITS.matcher(ungrouped);
        if (!integer.find() || integer.group().length() <= 3) {
            return ungrouped;
        }
        String digits = integer.group();
        String head = digits.substring(0, digits.length() - 3);
        String grouped = PAIRS_FROM_THE_RIGHT.matcher(head).replaceAll(",") + "," + digits.substring(head.length());
        return ungrouped.substring(0, integer.start()) + grouped + ungrouped.substring(integer.end());
    }
}
