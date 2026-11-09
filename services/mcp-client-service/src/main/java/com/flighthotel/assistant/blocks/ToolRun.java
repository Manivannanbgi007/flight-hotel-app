package com.flighthotel.assistant.blocks;

import java.util.Map;

/**
 * One tool call of an answer: the tool, what it returned (as maps and lists), and whether it returned an error.
 * Held only while the answer is built; it is not stored.
 */
public record ToolRun(String tool, Map<String, Object> result, boolean error) {

    /** The error code of a failed run ("NOT_FOUND", "UNAVAILABLE"...), or null. */
    public String errorCode() {
        return result != null && result.get("error") != null ? String.valueOf(result.get("error")) : null;
    }
}
