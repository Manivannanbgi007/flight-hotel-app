package com.flighthotel.mcpserver.tools;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * One input of a tool: its JSON schema (what the model sees) and its validation (what the server enforces). Both come
 * from the same definition, so they never disagree. Values the model sends are strings, numbers or booleans; strings
 * are trimmed, and enum and code values are upper-cased before they are checked.
 */
public final class Param {

    enum Type { STRING, INTEGER, BOOLEAN, DATE, ENUM }

    private final String name;
    private final Type type;
    private final String description;
    private final boolean required;
    private final Pattern pattern;
    private final String patternHint;
    private final int minLength;
    private final int maxLength;
    private final long minimum;
    private final long maximum;
    private final List<String> values;
    private final boolean upperCase;

    private Param(String name, Type type, String description, boolean required, Pattern pattern, String patternHint,
            int minLength, int maxLength, long minimum, long maximum, List<String> values, boolean upperCase) {
        this.name = name;
        this.type = type;
        this.description = description;
        this.required = required;
        this.pattern = pattern;
        this.patternHint = patternHint;
        this.minLength = minLength;
        this.maxLength = maxLength;
        this.minimum = minimum;
        this.maximum = maximum;
        this.values = values;
        this.upperCase = upperCase;
    }

    /** Free text, trimmed, {@code minLength}..{@code maxLength} characters, no control characters. */
    public static Param text(String name, String description, int minLength, int maxLength) {
        return new Param(name, Type.STRING, description, false, null, null, minLength, maxLength, 0, 0, null, false);
    }

    /** A code with a fixed format (booking reference, IATA code): upper-cased, then matched against {@code regex}. */
    public static Param code(String name, String description, String regex, String hint) {
        return new Param(name, Type.STRING, description, false, Pattern.compile(regex), hint, 1, 120, 0, 0, null,
                true);
    }

    public static Param integer(String name, String description, long minimum, long maximum) {
        return new Param(name, Type.INTEGER, description, false, null, null, 0, 0, minimum, maximum, null, false);
    }

    public static Param bool(String name, String description) {
        return new Param(name, Type.BOOLEAN, description, false, null, null, 0, 0, 0, 0, null, false);
    }

    /** {@code YYYY-MM-DD}. */
    public static Param date(String name, String description) {
        return new Param(name, Type.DATE, description, false, null, null, 0, 0, 0, 0, null, false);
    }

    public static Param oneOf(String name, String description, List<String> values) {
        return new Param(name, Type.ENUM, description, false, null, null, 0, 0, 0, 0, List.copyOf(values), true);
    }

    public Param required() {
        return new Param(name, type, description, true, pattern, patternHint, minLength, maxLength, minimum, maximum,
                values, upperCase);
    }

    public String name() {
        return name;
    }

    public boolean isRequired() {
        return required;
    }

    /** The JSON schema of this property. */
    Map<String, Object> schema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        switch (type) {
            case STRING -> {
                schema.put("type", "string");
                if (pattern == null) {
                    schema.put("maxLength", maxLength);
                }
            }
            case INTEGER -> {
                schema.put("type", "integer");
                schema.put("minimum", minimum);
                schema.put("maximum", maximum);
            }
            case BOOLEAN -> schema.put("type", "boolean");
            case DATE -> {
                schema.put("type", "string");
                schema.put("format", "date");
            }
            case ENUM -> {
                schema.put("type", "string");
                schema.put("enum", values);
            }
        }
        schema.put("description", description);
        return schema;
    }

    /**
     * Checks and normalises one value ({@code null} = not given).
     *
     * @throws ToolInputException with a message that is safe to show to the model and the user
     */
    Object validate(Object raw) {
        if (raw == null || (raw instanceof String text && text.isBlank())) {
            if (required) {
                throw new ToolInputException(name, "is required");
            }
            return null;
        }
        return switch (type) {
            case STRING -> validateString(raw);
            case INTEGER -> validateInteger(raw);
            case BOOLEAN -> validateBoolean(raw);
            case DATE -> validateDate(raw);
            case ENUM -> validateEnum(raw);
        };
    }

    private String validateString(Object raw) {
        if (!(raw instanceof String text)) {
            throw new ToolInputException(name, "must be text");
        }
        String value = text.strip();
        if (value.chars().anyMatch(c -> Character.isISOControl(c))) {
            throw new ToolInputException(name, "contains control characters");
        }
        if (upperCase) {
            value = value.toUpperCase(Locale.ROOT);
        }
        if (value.length() < minLength || value.length() > maxLength) {
            throw new ToolInputException(name, "must be " + minLength + " to " + maxLength + " characters");
        }
        if (pattern != null && !pattern.matcher(value).matches()) {
            throw new ToolInputException(name, "must look like " + patternHint);
        }
        return value;
    }

    private Long validateInteger(Object raw) {
        long value;
        if (raw instanceof Number number) {
            if (number.doubleValue() != Math.rint(number.doubleValue())) {
                throw new ToolInputException(name, "must be a whole number");
            }
            value = number.longValue();
        } else if (raw instanceof String text && text.strip().matches("-?\\d{1,9}")) {
            value = Long.parseLong(text.strip());
        } else {
            throw new ToolInputException(name, "must be a whole number");
        }
        if (value < minimum || value > maximum) {
            throw new ToolInputException(name, "must be between " + minimum + " and " + maximum);
        }
        return value;
    }

    private Boolean validateBoolean(Object raw) {
        if (raw instanceof Boolean value) {
            return value;
        }
        if (raw instanceof String text && ("true".equalsIgnoreCase(text.strip())
                || "false".equalsIgnoreCase(text.strip()))) {
            return Boolean.parseBoolean(text.strip());
        }
        throw new ToolInputException(name, "must be true or false");
    }

    private LocalDate validateDate(Object raw) {
        if (raw instanceof String text) {
            try {
                return LocalDate.parse(text.strip());
            } catch (DateTimeParseException ex) {
                // fall through
            }
        }
        throw new ToolInputException(name, "must be a date like 2026-12-31");
    }

    private String validateEnum(Object raw) {
        if (raw instanceof String text) {
            String value = text.strip().toUpperCase(Locale.ROOT).replace(' ', '_').replace('-', '_');
            if (values.contains(value)) {
                return value;
            }
        }
        throw new ToolInputException(name, "must be one of " + String.join(", ", values));
    }
}
