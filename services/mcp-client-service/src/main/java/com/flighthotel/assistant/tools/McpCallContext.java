package com.flighthotel.assistant.tools;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;

import io.modelcontextprotocol.common.McpTransportContext;

/**
 * Carries the user's access token to the MCP HTTP request of one call.
 * <p>
 * How it works (MCP Java SDK 2.1): {@code McpSyncClient} asks its {@code transportContextProvider} for the context
 * when the call is subscribed, which happens on the calling thread inside {@code .block()}. So the token is set in a
 * thread-local just around that one synchronous call ({@link #with}) and cleared right after; the
 * {@code McpSyncHttpClientRequestCustomizer} then reads it from the context and writes the {@code Authorization}
 * header. Every call runs on its own thread with its own value, so concurrent chats of different users never see
 * each other's token (verified by {@code McpTokenPropagationTest}).
 */
public final class McpCallContext {

    static final String ACCESS_TOKEN = "accessToken";
    static final String CORRELATION_ID = "correlationId";

    private static final ThreadLocal<McpTransportContext> CURRENT = new ThreadLocal<>();

    private McpCallContext() {
    }

    /** The provider given to the MCP client: the context of the current call, or empty. */
    public static McpTransportContext current() {
        McpTransportContext context = CURRENT.get();
        return context == null ? McpTransportContext.EMPTY : context;
    }

    /** Runs one synchronous MCP call as the user. */
    public static <T> T with(String accessToken, String correlationId, Supplier<T> call) {
        Map<String, Object> values = new HashMap<>();
        if (accessToken != null) {
            values.put(ACCESS_TOKEN, accessToken);
        }
        if (correlationId != null) {
            values.put(CORRELATION_ID, correlationId);
        }
        McpTransportContext previous = CURRENT.get();
        CURRENT.set(McpTransportContext.create(Map.copyOf(values)));
        try {
            return call.get();
        } finally {
            if (previous == null) {
                CURRENT.remove();
            } else {
                CURRENT.set(previous);
            }
        }
    }
}
