package com.flighthotel.search.support;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.Currency;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/** Small text helpers shared by the listeners (document titles) and the result mapper (what users read). */
public final class Format {

    private static final Locale INDIA = Locale.of("en", "IN");
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);

    private Format() {
    }

    /** {@code 12400.5, "INR"} → {@code ₹12,400.50}. */
    public static String money(Object amount, Object currency) {
        if (amount == null) {
            return null;
        }
        BigDecimal value = new BigDecimal(String.valueOf(amount));
        String code = currency == null ? "INR" : String.valueOf(currency);
        NumberFormat format = NumberFormat.getCurrencyInstance(INDIA);
        try {
            format.setCurrency(Currency.getInstance(code));
        } catch (IllegalArgumentException ex) {
            return code + " " + value.toPlainString();
        }
        return format.format(value);
    }

    /** An ISO date or instant ({@code 2026-11-12}, {@code 2026-11-12T08:30:00Z}) → {@code 12 Nov 2026} (India time). */
    public static String date(Object iso) {
        LocalDate day = toDate(iso);
        return day == null ? null : DAY.format(day);
    }

    /** {@code 12 – 14 Nov 2026}, or one date when there is no end. */
    public static String dateRange(Object startIso, Object endIso) {
        LocalDate start = toDate(startIso);
        LocalDate end = toDate(endIso);
        if (start == null) {
            return null;
        }
        if (end == null || end.equals(start)) {
            return DAY.format(start);
        }
        String from = start.getYear() == end.getYear() ? DAY_MONTH.format(start) : DAY.format(start);
        return from + " – " + DAY.format(end);
    }

    /** {@code PENDING_PAYMENT} → {@code Pending payment}. */
    public static String humanize(Object constant) {
        if (constant == null) {
            return null;
        }
        String text = String.valueOf(constant).replace('_', ' ').toLowerCase(Locale.ROOT);
        return text.isEmpty() ? text : Character.toUpperCase(text.charAt(0)) + text.substring(1);
    }

    /** The first 8 characters of an id, for titles of records without a reference. */
    public static String shortId(String id) {
        return id == null ? "" : id.substring(0, Math.min(8, id.length()));
    }

    /** {@code IN} → {@code India}; the code itself when unknown. */
    public static String country(Object code) {
        if (code == null) {
            return null;
        }
        String name = Locale.of("", String.valueOf(code)).getDisplayCountry(Locale.ENGLISH);
        return name.isBlank() ? String.valueOf(code) : name;
    }

    /** Joins the non-blank parts with " · ". */
    public static String join(Object... parts) {
        return Arrays.stream(parts).filter(Objects::nonNull).map(String::valueOf).map(String::strip)
                .filter(part -> !part.isEmpty()).collect(Collectors.joining(" · "));
    }

    /** The first non-blank value. */
    public static String firstNonBlank(String... values) {
        return Arrays.stream(values).filter(value -> value != null && !value.isBlank()).findFirst().orElse(null);
    }

    /** A map of the pairs whose value is not null: {@code map("email", email, "rating", 4)}. */
    public static Map<String, Object> map(Object... keysAndValues) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i + 1 < keysAndValues.length; i += 2) {
            if (keysAndValues[i + 1] != null) {
                map.put(String.valueOf(keysAndValues[i]), keysAndValues[i + 1]);
            }
        }
        return map;
    }

    private static LocalDate toDate(Object iso) {
        if (iso == null) {
            return null;
        }
        if (iso instanceof LocalDate date) {
            return date;
        }
        if (iso instanceof Instant instant) {
            return instant.atZone(IST).toLocalDate();
        }
        String text = String.valueOf(iso);
        try {
            return text.length() <= 10 ? LocalDate.parse(text) : Instant.parse(text).atZone(IST).toLocalDate();
        } catch (RuntimeException ex) {
            return null;
        }
    }
}
