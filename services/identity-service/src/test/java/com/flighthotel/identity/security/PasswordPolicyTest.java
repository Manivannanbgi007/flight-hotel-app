package com.flighthotel.identity.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import org.assertj.core.api.InstanceOfAssertFactories;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.api.Test;

import com.flighthotel.common.error.BusinessRuleException;

class PasswordPolicyTest {

    private final PasswordPolicy policy = new PasswordPolicy();

    @Test
    void acceptsAGoodPassword() {
        assertThatCode(() -> policy.check("Travel2026Safe", "asha@example.com")).doesNotThrowAnyException();
        assertThatCode(() -> policy.check("पासवर्ड2026सुरक्षित", null)).as("any language").doesNotThrowAnyException();
    }

    @ParameterizedTest
    @CsvSource({
            "short1,               LENGTH",
            "onlyletterslong,      DIGIT",
            "12345678901,          LETTER",
            "Password123,          NOT_COMMON",
            "asha2026@example.com, NOT_EMAIL"
    })
    void reportsTheBrokenRule(String password, String rule) {
        BusinessRuleException error = catchThrowableOfType(BusinessRuleException.class,
                () -> policy.check(password, "asha2026@example.com"));
        assertThat(error.getCode()).isEqualTo("WEAK_PASSWORD");
        assertThat(error.getDetails().get("rules")).asInstanceOf(InstanceOfAssertFactories.LIST).contains(rule);
    }

    @Test
    void rejectsPasswordsBCryptWouldTruncate() {
        // 24 three-byte characters + 10 digits: only 34 characters, but 82 bytes in UTF-8.
        String password = "€".repeat(24) + "1234567890";
        BusinessRuleException error = catchThrowableOfType(BusinessRuleException.class, () -> policy.check(password, null));
        assertThat(error.getDetails().get("rules")).asInstanceOf(InstanceOfAssertFactories.LIST).contains("MAX_BYTES");
    }
}
