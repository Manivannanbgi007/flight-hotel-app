package com.flighthotel.booking.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;

import com.flighthotel.common.error.ApiException;

/** The {@code Idempotency-Key} rules of API_DOCUMENTATION.md section 8.1, shared by the actions that move money. */
final class IdempotencyKeys {

    private static final Pattern KEY = Pattern.compile("^[A-Za-z0-9_-]{8,100}$");

    private IdempotencyKeys() {
    }

    static String require(String key) {
        if (key == null || key.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED",
                    "The Idempotency-Key header is required.");
        }
        if (!KEY.matcher(key).matches()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY",
                    "The Idempotency-Key must be 8-100 letters, digits, '-' or '_'.");
        }
        return key;
    }

    /** SHA-256 of the request, to recognise "same key, different request". */
    static String fingerprint(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
