package com.flighthotel.mcpserver.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Settings of the MCP tool server ({@code mcp-server.*}).
 *
 * @param apiKey   shared secret mcp-client-service sends in {@value #API_KEY_HEADER} ({@code MCP_SERVER_API_KEY});
 *                 the service refuses to start without one
 * @param gateway  how the tools reach the API gateway
 * @param breaker  the circuit breaker per downstream area
 */
@ConfigurationProperties("mcp-server")
public record McpServerProperties(
        String apiKey,
        @DefaultValue Gateway gateway,
        @DefaultValue Breaker breaker) {

    public static final String API_KEY_HEADER = "X-MCP-Api-Key";

    public McpServerProperties {
        if (apiKey == null || apiKey.length() < 32) {
            throw new IllegalStateException(
                    "mcp-server.api-key (MCP_SERVER_API_KEY) must be set to a random value of at least 32 characters");
        }
    }

    /**
     * @param url            the API gateway, e.g. {@code http://api-gateway:8080}
     * @param connectTimeout TCP connect timeout
     * @param readTimeout    time to wait for the answer of one request
     */
    public record Gateway(
            @DefaultValue("http://localhost:8080") String url,
            @DefaultValue("2s") Duration connectTimeout,
            @DefaultValue("8s") Duration readTimeout) {
    }

    /**
     * @param failureThreshold consecutive failures (timeouts, 5xx) that open the breaker
     * @param openFor          how long calls fail fast before one trial call is let through
     */
    public record Breaker(
            @DefaultValue("5") int failureThreshold,
            @DefaultValue("30s") Duration openFor) {
    }
}
