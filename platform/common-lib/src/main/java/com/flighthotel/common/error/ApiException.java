package com.flighthotel.common.error;

import java.util.Map;

import org.springframework.http.HttpStatus;

/**
 * Base class for every business error that should reach the client as a Problem Details response.
 * <p>
 * {@code code} is a stable, machine-readable value (for example {@code BOOKING_NOT_FOUND}) that the
 * frontend can rely on. {@code message} is safe to show to users: never put internal details in it.
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final Map<String, Object> details;

    public ApiException(HttpStatus status, String code, String message) {
        this(status, code, message, Map.of());
    }

    public ApiException(HttpStatus status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = Map.copyOf(details);
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public Map<String, Object> getDetails() {
        return details;
    }
}
