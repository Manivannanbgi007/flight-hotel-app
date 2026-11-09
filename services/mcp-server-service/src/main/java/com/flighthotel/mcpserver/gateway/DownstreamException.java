package com.flighthotel.mcpserver.gateway;

/**
 * A gateway call that did not give a usable answer. {@link Kind} is all a tool needs to tell the user; the HTTP status
 * and the service's error code are kept for logs and tests only, never shown to the model.
 */
public class DownstreamException extends RuntimeException {

    public enum Kind {
        /** 401, 403, 404: the same answer for all three, so nothing about other users' data leaks. */
        NOT_FOUND_OR_NOT_ALLOWED,
        /** 400, 409, 422: the request was refused (bad filter, invalid range). */
        REJECTED,
        /** 429 at the gateway. */
        BUSY,
        /** 5xx, timeouts, connection errors, open circuit breaker. */
        UNAVAILABLE
    }

    private final Kind kind;
    private final int status;
    private final String code;

    public DownstreamException(Kind kind, int status, String code, String message) {
        super(message);
        this.kind = kind;
        this.status = status;
        this.code = code;
    }

    public Kind kind() {
        return kind;
    }

    public int status() {
        return status;
    }

    /** The service's Problem Details {@code code}, if any. */
    public String code() {
        return code;
    }

    public static Kind kindOf(int status) {
        if (status == 401 || status == 403 || status == 404) {
            return Kind.NOT_FOUND_OR_NOT_ALLOWED;
        }
        if (status == 429) {
            return Kind.BUSY;
        }
        if (status >= 500) {
            return Kind.UNAVAILABLE;
        }
        return Kind.REJECTED;
    }
}
