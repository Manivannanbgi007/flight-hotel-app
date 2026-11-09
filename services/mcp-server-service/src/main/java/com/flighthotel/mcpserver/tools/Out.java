package com.flighthotel.mcpserver.tools;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import com.flighthotel.common.text.IndianDigits;

import tools.jackson.databind.JsonNode;

/**
 * Builds the compact tool results: only the fields the model needs, amounts already written the way the app shows
 * them ("₹6,300", "₹2,00,000.50"), no ids the user never sees, passport numbers masked. Small models copy
 * pre-formatted values far more reliably than they format numbers themselves.
 */
public final class Out {

    private Out() {
    }

    /** The listed fields of {@code node} that are present and not null, in that order. */
    public static Map<String, Object> pick(JsonNode node, String... fields) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (node == null || node.isMissingNode() || node.isNull()) {
            return out;
        }
        for (String field : fields) {
            put(out, field, scalar(node.get(field)));
        }
        return out;
    }

    /** Adds {@code key → value} unless the value is null, an empty string or an empty collection. */
    public static void put(Map<String, Object> out, String key, Object value) {
        if (value == null || (value instanceof String text && text.isEmpty())
                || (value instanceof java.util.Collection<?> collection && collection.isEmpty())
                || (value instanceof Map<?, ?> map && map.isEmpty())) {
            return;
        }
        out.put(key, value);
    }

    /** A JSON value as a plain Java value (text, number, boolean; arrays of scalars as lists). */
    public static Object scalar(JsonNode value) {
        if (value == null || value.isMissingNode() || value.isNull()) {
            return null;
        }
        if (value.isString()) {
            return value.stringValue();
        }
        if (value.isBoolean()) {
            return value.booleanValue();
        }
        if (value.isNumber()) {
            // 24.0 → 24, 3.50 → 3.5 (never "2.4E+1": the model copies numbers as written).
            BigDecimal number = value.decimalValue().stripTrailingZeros();
            return number.scale() <= 0 ? number.longValue() : number;
        }
        if (value.isArray()) {
            List<Object> items = new ArrayList<>();
            for (JsonNode item : value) {
                Object scalar = scalar(item);
                if (scalar != null && !(item.isObject())) {
                    items.add(scalar);
                }
            }
            return items;
        }
        return null;
    }

    public static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() || value.isMissingNode() ? null : value.asString();
    }

    /** {@code 6300.00, "INR"} → "₹6,300"; {@code 1234.5} → "₹1,234.50"; other currencies "1,234.50 USD". */
    public static String money(JsonNode amount, String currency) {
        if (amount == null || amount.isNull() || amount.isMissingNode() || !amount.isNumber()) {
            return null;
        }
        return money(amount.decimalValue(), currency);
    }

    public static String money(BigDecimal amount, String currency) {
        if (amount == null) {
            return null;
        }
        BigDecimal value = amount.setScale(2, RoundingMode.HALF_UP);
        boolean whole = value.remainder(BigDecimal.ONE).signum() == 0;
        String plain = whole ? value.setScale(0, RoundingMode.UNNECESSARY).toPlainString() : value.toPlainString();
        String sign = plain.startsWith("-") ? "-" : "";
        String digits = sign.isEmpty() ? plain : plain.substring(1);
        if (currency == null || "INR".equalsIgnoreCase(currency)) {
            return sign + IndianDigits.group("₹" + digits);
        }
        return sign + IndianDigits.group(digits) + " " + currency;
    }

    /** Adds {@code key → money(node[field])}. */
    public static void money(Map<String, Object> out, String key, JsonNode node, String field, String currency) {
        put(out, key, money(node == null ? null : node.get(field), currency));
    }

    public static String currency(JsonNode node) {
        String currency = text(node, "currency");
        return currency == null ? "INR" : currency;
    }

    /** Only the last four characters, never more: "****1234". */
    public static String maskPassport(String last4) {
        if (last4 == null || last4.isBlank()) {
            return null;
        }
        String tail = last4.length() > 4 ? last4.substring(last4.length() - 4) : last4;
        return "****" + tail;
    }

    /** At most {@code limit} items of a JSON array, each mapped. */
    public static List<Map<String, Object>> rows(JsonNode array, int limit, Function<JsonNode, Map<String, Object>> mapper) {
        List<Map<String, Object>> rows = new ArrayList<>();
        if (array == null || !array.isArray()) {
            return rows;
        }
        for (JsonNode item : array) {
            if (rows.size() >= limit) {
                break;
            }
            rows.add(mapper.apply(item));
        }
        return rows;
    }

    /** Page responses ({@code content}, {@code totalElements}). */
    public static JsonNode content(JsonNode page) {
        return page == null ? null : page.path("content");
    }

    public static long total(JsonNode page) {
        JsonNode total = page == null ? null : page.get("totalElements");
        return total == null || !total.isNumber() ? 0 : total.longValue();
    }

    /** The instant if it is still ahead, otherwise {@code null} (a deadline that has passed is left out). */
    public static String future(String isoInstant, java.time.Instant now) {
        if (isoInstant == null) {
            return null;
        }
        try {
            return java.time.Instant.parse(isoInstant).isAfter(now) ? isoInstant : null;
        } catch (java.time.format.DateTimeParseException ex) {
            return isoInstant;
        }
    }

    /** Shortens long free text (descriptions, policies) for the model. */
    public static String shorten(String text, int max) {
        if (text == null) {
            return null;
        }
        String clean = text.replaceAll("\\s+", " ").strip();
        return clean.length() <= max ? clean : clean.substring(0, max - 1).strip() + "…";
    }

    public static Map<String, Object> map(Object... keyValues) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            put(out, (String) keyValues[i], keyValues[i + 1]);
        }
        return out;
    }
}
