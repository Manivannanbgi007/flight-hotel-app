package com.flighthotel.identity.security;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;

import com.flighthotel.common.error.BusinessRuleException;

/**
 * Password rules (the frontend shows the same rules as a checklist):
 * 10–64 characters, at least one letter and one digit, not the email, not a commonly used password, and at most
 * 72 bytes in UTF-8 (BCrypt ignores anything beyond 72 bytes).
 */
@Component
public class PasswordPolicy {

    public static final int MIN_LENGTH = 10;
    public static final int MAX_LENGTH = 64;
    public static final int MAX_BYTES = 72;

    /** A small list of the most guessed passwords that would otherwise pass the rules. */
    private static final Set<String> COMMON = Set.of(
            "password123", "password1234", "password12345", "qwerty12345", "qwerty123456", "1234567890a",
            "a1234567890", "welcome123", "welcome1234", "iloveyou123", "admin12345", "letmein1234", "abc1234567",
            "abcd123456", "passw0rd123", "p@ssw0rd123", "travel12345", "flighthotel1", "india123456", "summer2026",
            "winter2026", "monkey12345", "dragon12345", "football123", "sunshine123");

    public void check(String password, String email) {
        List<String> failed = new ArrayList<>();
        if (password == null) {
            password = "";
        }
        if (password.length() < MIN_LENGTH || password.length() > MAX_LENGTH) {
            failed.add("LENGTH");
        }
        if (password.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            failed.add("MAX_BYTES");
        }
        if (password.chars().noneMatch(Character::isLetter)) {
            failed.add("LETTER");
        }
        if (password.chars().noneMatch(Character::isDigit)) {
            failed.add("DIGIT");
        }
        if (email != null && password.equalsIgnoreCase(email.trim())) {
            failed.add("NOT_EMAIL");
        }
        if (COMMON.contains(password.toLowerCase(Locale.ROOT))) {
            failed.add("NOT_COMMON");
        }
        if (!failed.isEmpty()) {
            throw new BusinessRuleException("WEAK_PASSWORD", "The password does not meet the password rules",
                    Map.of("rules", failed));
        }
    }
}
