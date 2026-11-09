package com.flighthotel.mcpserver.tools;

import java.time.LocalDate;
import java.util.Map;

/** The validated arguments of one tool call. Absent optional values are {@code null}. */
public final class Args {

    private final Map<String, Object> values;

    Args(Map<String, Object> values) {
        this.values = values;
    }

    public String text(String name) {
        return (String) values.get(name);
    }

    public String text(String name, String fallback) {
        String value = text(name);
        return value == null ? fallback : value;
    }

    public Integer integer(String name, int fallback) {
        Long value = (Long) values.get(name);
        return value == null ? fallback : value.intValue();
    }

    public Integer integer(String name) {
        Long value = (Long) values.get(name);
        return value == null ? null : value.intValue();
    }

    public Boolean bool(String name) {
        return (Boolean) values.get(name);
    }

    public LocalDate date(String name) {
        return (LocalDate) values.get(name);
    }

    public boolean has(String name) {
        return values.get(name) != null;
    }
}
