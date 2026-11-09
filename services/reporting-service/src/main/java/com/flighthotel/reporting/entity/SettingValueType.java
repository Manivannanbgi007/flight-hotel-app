package com.flighthotel.reporting.entity;

import java.math.BigDecimal;
import java.time.Duration;

/** The allowed value types of a system setting, with the validation for each. */
public enum SettingValueType {
    STRING {
        @Override
        void validate(String value) {
            // any text
        }
    },
    INTEGER {
        @Override
        void validate(String value) {
            Long.parseLong(value);
        }
    },
    DECIMAL {
        @Override
        void validate(String value) {
            new BigDecimal(value);
        }
    },
    BOOLEAN {
        @Override
        void validate(String value) {
            if (!"true".equals(value) && !"false".equals(value)) {
                throw new IllegalArgumentException("Expected true or false");
            }
        }
    },
    DURATION {
        @Override
        void validate(String value) {
            Duration.parse(value);
        }
    };

    /** @throws IllegalArgumentException (or a subclass) when the value does not match the type */
    abstract void validate(String value);

    public boolean isValid(String value) {
        if (value == null) {
            return true;
        }
        try {
            validate(value.trim());
            return true;
        } catch (RuntimeException ex) {
            return false;
        }
    }
}
