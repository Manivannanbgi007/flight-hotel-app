package com.flighthotel.assistant;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * The AI assistant's chat API (AI_ASSISTANT.md): a local model on Ollama answers with the read-only MCP tools of the
 * user's role, served by mcp-server-service with the user's own token.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class McpClientServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(McpClientServiceApplication.class, args);
    }
}
