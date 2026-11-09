package com.flighthotel.mcpserver.tools;

/**
 * A tool cannot answer, with a message written for the user (for example "No booking HT-… was found for you").
 * {@code code} is one of {@code NOT_FOUND}, {@code NEEDS_INPUT}, {@code INVALID_ARGUMENT}, {@code NOT_ALLOWED},
 * {@code UNAVAILABLE}.
 */
public class ToolFailure extends RuntimeException {

    private final String code;

    public ToolFailure(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
