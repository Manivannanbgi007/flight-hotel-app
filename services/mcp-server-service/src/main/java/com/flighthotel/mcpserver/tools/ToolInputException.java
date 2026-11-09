package com.flighthotel.mcpserver.tools;

/** A tool argument the model sent is missing or invalid. The message is ours (safe to return), never echoed input. */
public class ToolInputException extends RuntimeException {

    private final String field;

    public ToolInputException(String field, String problem) {
        super(field + " " + problem);
        this.field = field;
    }

    public String field() {
        return field;
    }
}
