package com.flighthotel.search.index;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * The fields of one search document, collected step by step by a listener. Empty values (null, blank text, empty
 * lists) are simply left out, so an event that does not know a value never wipes out one another event wrote.
 * Dates become ISO text (Elasticsearch parses it); lists lose duplicates and blanks.
 */
public final class Fields {

    private final Map<String, Object> values = new LinkedHashMap<>();

    private Fields() {
    }

    /** A document of this category about this business record (booking id, user id, ...). */
    public static Fields of(SearchCategory category, String entityId) {
        Fields fields = new Fields();
        fields.values.put("category", category.name());
        fields.values.put("entityId", entityId);
        return fields;
    }

    /** Fields without category and id, for partial updates that only add details. */
    public static Fields partial() {
        return new Fields();
    }

    public Fields put(String name, Object value) {
        Object clean = clean(value);
        if (clean != null) {
            values.put(name, clean);
        }
        return this;
    }

    /** Adds the values to a list field (keeping what is already there). */
    public Fields add(String name, Object... more) {
        List<Object> list = new ArrayList<>();
        Object current = values.get(name);
        if (current instanceof List<?> existing) {
            list.addAll(existing);
        }
        for (Object value : more) {
            if (value instanceof Collection<?> collection) {
                list.addAll(collection);
            } else {
                list.add(value);
            }
        }
        return put(name, list);
    }

    public boolean has(String name) {
        return values.containsKey(name);
    }

    public Map<String, Object> asMap() {
        return Map.copyOf(values);
    }

    private static Object clean(Object value) {
        return switch (value) {
            case null -> null;
            case String text -> text.isBlank() ? null : text.strip();
            case Instant instant -> instant.toString();
            case LocalDate date -> date.toString();
            case BigDecimal amount -> amount;
            case Collection<?> collection -> {
                Set<Object> unique = new LinkedHashSet<>();
                collection.stream().map(Fields::clean).filter(Objects::nonNull).forEach(unique::add);
                yield unique.isEmpty() ? null : List.copyOf(unique);
            }
            case Map<?, ?> map -> {
                Map<String, Object> copy = new LinkedHashMap<>();
                map.forEach((key, item) -> {
                    Object cleanItem = clean(item);
                    if (cleanItem != null) {
                        copy.put(String.valueOf(key), cleanItem);
                    }
                });
                yield copy.isEmpty() ? null : copy;
            }
            default -> value;
        };
    }
}
