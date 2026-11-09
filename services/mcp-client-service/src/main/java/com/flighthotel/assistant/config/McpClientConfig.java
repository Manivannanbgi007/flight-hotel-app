package com.flighthotel.assistant.config;

import org.springframework.ai.mcp.customizer.McpClientCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.flighthotel.assistant.tools.McpCallContext;
import com.flighthotel.common.correlation.CorrelationId;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.client.transport.customizer.McpSyncHttpClientRequestCustomizer;

/**
 * The MCP client (Spring AI starter, JDK HttpClient Streamable HTTP transport) to mcp-server-service:
 * <ul>
 * <li>every HTTP request carries the internal key {@code X-MCP-Api-Key};</li>
 * <li>a call made as a user ({@link McpCallContext#with}) also carries that user's {@code Authorization: Bearer}
 * token and the correlation ID, taken from the MCP transport context of that very call.</li>
 * </ul>
 */
@Configuration
public class McpClientConfig {

    public static final String API_KEY_HEADER = "X-MCP-Api-Key";

    @Bean
    McpSyncHttpClientRequestCustomizer mcpAuthHeaders(AssistantProperties properties) {
        String apiKey = properties.mcp().apiKey();
        if (apiKey == null || apiKey.length() < 32) {
            throw new IllegalStateException(
                    "assistant.mcp.api-key (MCP_SERVER_API_KEY) must be set to a random value of at least 32 characters");
        }
        return (builder, method, endpoint, body, context) -> {
            builder.header(API_KEY_HEADER, apiKey);
            if (context.get("accessToken") instanceof String token) {
                builder.header("Authorization", "Bearer " + token);
            }
            if (context.get("correlationId") instanceof String correlationId) {
                builder.header(CorrelationId.HEADER, correlationId);
            }
        };
    }

    @Bean
    McpClientCustomizer<HttpClientStreamableHttpTransport.Builder> mcpTransportTimeouts(
            AssistantProperties properties) {
        return (name, builder) -> builder.connectTimeout(properties.mcp().connectTimeout());
    }

    @Bean
    McpClientCustomizer<McpClient.SyncSpec> mcpUserContext() {
        return (name, spec) -> spec.transportContextProvider(McpCallContext::current);
    }
}
