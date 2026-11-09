package com.flighthotel.common.correlation;

import java.util.UUID;
import java.util.regex.Pattern;

import org.slf4j.MDC;

/**
 * The correlation ID ties together every log line, event and supplier call that belongs to one user request.
 * It is created at the API gateway, passed in the {@value #HEADER} header, stored in the logging MDC and
 * copied into every outbox event.
 */
public final class CorrelationId {

    public static final String HEADER = "X-Correlation-Id";
    public static final String MDC_KEY = "correlationId";

    /** Only accept simple values from outside, so a client cannot inject anything into our logs. */
    private static final Pattern SAFE_VALUE = Pattern.compile("^[A-Za-z0-9._-]{8,64}$");

    private CorrelationId() {
    }

    /** Returns the given value if it is safe, otherwise a new random ID. */
    public static String sanitizeOrCreate(String candidate) {
        if (candidate != null && SAFE_VALUE.matcher(candidate).matches()) {
            return candidate;
        }
        return UUID.randomUUID().toString();
    }

    /** The correlation ID of the current thread, or {@code null} outside a request/event. */
    public static String current() {
        return MDC.get(MDC_KEY);
    }
}
