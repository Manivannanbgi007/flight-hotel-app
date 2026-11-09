package com.flighthotel.mcpserver;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Read-only MCP tools for the AI assistant (AI_ASSISTANT.md). Only mcp-client-service calls it, inside the Docker
 * network; the API gateway never routes to it. Every tool calls the gateway with the user's own access token.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class McpServerServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(McpServerServiceApplication.class, args);
    }
}
