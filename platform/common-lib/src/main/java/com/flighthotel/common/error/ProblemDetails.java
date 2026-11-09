package com.flighthotel.common.error;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;

import com.flighthotel.common.correlation.CorrelationId;

/**
 * Builds RFC 9457 Problem Details responses with the extra fields every client can rely on:
 * {@code code}, {@code correlationId}, {@code timestamp} and, for validation errors, {@code errors}.
 */
public final class ProblemDetails {

    private ProblemDetails() {
    }

    public static ProblemDetail of(HttpStatusCode status, String code, String message) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, message);
        problem.setType(URI.create("about:blank"));
        problem.setProperty("code", code);
        problem.setProperty("correlationId", CorrelationId.current());
        problem.setProperty("timestamp", Instant.now().toString());
        return problem;
    }

    public static ProblemDetail withDetails(ProblemDetail problem, Map<String, Object> details) {
        if (!details.isEmpty()) {
            problem.setProperty("details", details);
        }
        return problem;
    }

    public static ProblemDetail withFieldErrors(ProblemDetail problem, List<FieldError> errors) {
        problem.setProperty("errors", errors);
        return problem;
    }

    /** One invalid input field. {@code field} uses the JSON property path, e.g. {@code passengers[0].lastName}. */
    public record FieldError(String field, String message) {
    }
}
