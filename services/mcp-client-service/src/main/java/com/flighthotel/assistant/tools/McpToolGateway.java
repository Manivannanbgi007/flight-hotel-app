package com.flighthotel.assistant.tools;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.flighthotel.assistant.config.AssistantProperties;
import com.flighthotel.common.correlation.CorrelationId;
import com.flighthotel.common.security.AuthenticatedUser;

import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.spec.McpSchema;

/**
 * The assistant's only way to data: the MCP server, always as the signed-in user.
 * <ul>
 * <li>{@link #toolsFor}: {@code tools/list} with the user's token. The server lists only the tools of the user's
 * roles; the list is cached per role combination for {@code assistant.mcp.tool-list-cache-ttl}.</li>
 * <li>{@link #call}: {@code tools/call} with the user's token.</li>
 * </ul>
 */
@Component
public class McpToolGateway {

    private static final Logger log = LoggerFactory.getLogger(McpToolGateway.class);

    private final McpSyncClient client;
    private final AssistantProperties.Mcp settings;
    private final Clock clock;
    private final Map<String, CachedTools> cache = new ConcurrentHashMap<>();

    public McpToolGateway(List<McpSyncClient> clients, AssistantProperties properties, Clock clock) {
        if (clients.size() != 1) {
            throw new IllegalStateException("Exactly one MCP connection (spring.ai.mcp.client.streamable-http."
                    + "connections) is expected, found " + clients.size());
        }
        this.client = clients.getFirst();
        this.settings = properties.mcp();
        this.clock = clock;
    }

    /** The tools the user's roles may use. Throws {@link ToolsUnavailableException} if the server cannot be reached. */
    public List<McpSchema.Tool> toolsFor(AuthenticatedUser user, String accessToken) {
        String key = new TreeSet<>(user.roles()).stream().collect(Collectors.joining(","));
        CachedTools cached = cache.get(key);
        Instant now = clock.instant();
        if (cached != null && cached.until().isAfter(now)) {
            return cached.tools();
        }
        try {
            List<McpSchema.Tool> tools = McpCallContext.with(accessToken, CorrelationId.current(),
                    () -> client.listTools().tools());
            cache.put(key, new CachedTools(List.copyOf(tools), now.plus(settings.toolListCacheTtl())));
            log.info("MCP tools listed: roles={} tools={}", key, tools.size());
            return tools;
        } catch (RuntimeException ex) {
            log.warn("MCP tools/list failed: {}", ex.getClass().getSimpleName());
            throw new ToolsUnavailableException(ex);
        }
    }

    /** One tool call as the user. The result text is the tool's JSON (or a JSON error the model can explain). */
    public ToolResult call(String toolName, Map<String, Object> arguments, String accessToken,
            String correlationId) {
        McpSchema.CallToolResult result = McpCallContext.with(accessToken, correlationId,
                () -> client.callTool(McpSchema.CallToolRequest.builder(toolName).arguments(arguments).build()));
        StringBuilder text = new StringBuilder();
        for (McpSchema.Content content : result.content()) {
            if (content instanceof McpSchema.TextContent textContent) {
                text.append(textContent.text());
            }
        }
        return new ToolResult(text.toString(), Boolean.TRUE.equals(result.isError()));
    }

    /** Forgets cached tool lists (tests, or after the server's tools changed). */
    public void clearCache() {
        cache.clear();
    }

    public record ToolResult(String text, boolean error) {
    }

    private record CachedTools(List<McpSchema.Tool> tools, Instant until) {
    }

    /** The MCP server could not be reached or did not answer. */
    public static class ToolsUnavailableException extends RuntimeException {
        public ToolsUnavailableException(Throwable cause) {
            super("MCP server unavailable", cause);
        }
    }
}
