package com.flighthotel.assistant;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

import com.flighthotel.assistant.status.AssistantStatus;
import com.flighthotel.assistant.tools.McpToolGateway;

import tools.jackson.databind.json.JsonMapper;

/**
 * The running service with stub Ollama, MCP and speech servers and a real Redis (one Spring context for all
 * integration test classes: the stubs and the container live as long as the JVM).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "assistant.model.name=test-model",
        "assistant.model.warm-up=false",
        "assistant.chat.status-cache-ttl=0s",
        "assistant.chat.first-token-timeout=10s",
        "assistant.chat.idle-timeout=10s",
        "assistant.chat.total-timeout=20s",
        "assistant.mcp.api-key=" + AssistantIntegrationTest.API_KEY,
        "assistant.mcp.tool-list-cache-ttl=0s"
})
@Import(TestTokens.LocalKeys.class)
abstract class AssistantIntegrationTest {

    static final String API_KEY = "assistant-flow-test-key-0123456789abcdef";
    static final Stubs.Ollama OLLAMA = new Stubs.Ollama();
    static final Stubs.McpServer MCP = new Stubs.McpServer();
    static final Stubs.Speech SPEECH = new Stubs.Speech();
    static final JsonMapper JSON = JsonMapper.builder().build();
    static final GenericContainer<?> REDIS = new GenericContainer<>(DockerImageName.parse("redis:8.4.8"))
            .withExposedPorts(6379);

    static {
        REDIS.start();
    }

    @DynamicPropertySource
    static void endpoints(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
        registry.add("assistant.model.base-url", OLLAMA::url);
        registry.add("spring.ai.ollama.base-url", OLLAMA::url);
        registry.add("spring.ai.mcp.client.streamable-http.connections.travel.url", MCP::url);
        registry.add("assistant.voice.stt-url", SPEECH::url);
        registry.add("assistant.voice.tts-url", SPEECH::url);
    }

    @LocalServerPort
    int port;

    @Autowired
    StringRedisTemplate redisTemplate;

    @Autowired
    McpToolGateway toolGateway;

    @Autowired
    AssistantStatus status;

    @BeforeEach
    void resetStubs() {
        OLLAMA.chatRequests.clear();
        OLLAMA.model = "test-model";
        OLLAMA.capabilities = List.of("completion", "tools");
        MCP.calls.clear();
        MCP.failStatus = 0;
        MCP.results = (tool, authorization) -> "{\"bookings\":[{\"reference\":\"HT-7K3M9Q2X\",\"total\":\"₹6,300\"}]}";
        SPEECH.requests.clear();
        toolGateway.clearCache();
        status.invalidate();
    }

    String url(String path) {
        return "http://localhost:" + port + path;
    }

    SseClient.Result chat(String token, String message, String conversationId) throws Exception {
        String body = conversationId == null ? JSON.writeValueAsString(Map.of("message", message))
                : JSON.writeValueAsString(Map.of("message", message, "conversationId", conversationId));
        return SseClient.post(url("/api/assistant/chat"), token, body);
    }

    HttpResponse<String> send(String method, String path, String token) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url(path))).method(method,
                HttpRequest.BodyPublishers.noBody());
        if (token != null) {
            request.header("Authorization", "Bearer " + token);
        }
        return HttpClient.newHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
