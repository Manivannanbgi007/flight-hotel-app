package com.flighthotel.mcpserver;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.flighthotel.mcpserver.StubGateway.Answer;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.spec.McpSchema;

/**
 * The MCP server end to end: a real MCP client (Streamable HTTP, like mcp-client-service) against the running
 * service, and a stub gateway behind it. Checks the role-based tool list, that every gateway call carries the
 * calling user's own token, and that refusals and other users' data come back as "not found or not allowed".
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.data.redis.port=6399",
        "mcp-server.api-key=" + McpToolServerIntegrationTest.API_KEY
})
@Import(TestTokens.LocalKeys.class)
class McpToolServerIntegrationTest {

    static final String API_KEY = "integration-test-key-0123456789-abcdefghij";
    private static final ThreadLocal<String> TOKEN = new ThreadLocal<>();
    private static StubGateway gateway;

    @LocalServerPort
    int port;

    private McpSyncClient client;

    @BeforeAll
    static void startGateway() throws IOException {
        gateway = new StubGateway();
    }

    @AfterAll
    static void stopGateway() {
        gateway.close();
    }

    @DynamicPropertySource
    static void gatewayUrl(DynamicPropertyRegistry registry) {
        registry.add("mcp-server.gateway.url", () -> gateway.url());
    }

    @BeforeEach
    void connect() {
        gateway.reset();
        HttpClientStreamableHttpTransport transport = HttpClientStreamableHttpTransport
                .builder("http://localhost:" + port)
                .endpoint("/mcp")
                .httpRequestCustomizer((builder, method, uri, body, context) -> {
                    builder.header("X-MCP-Api-Key", API_KEY);
                    if (context.get("token") instanceof String token) {
                        builder.header("Authorization", "Bearer " + token);
                    }
                })
                .build();
        client = McpClient.sync(transport).requestTimeout(Duration.ofSeconds(15))
                .transportContextProvider(() -> TOKEN.get() == null ? McpTransportContext.EMPTY
                        : McpTransportContext.create(Map.of("token", TOKEN.get())))
                .build();
    }

    @AfterEach
    void close() {
        client.closeGracefully();
    }

    private <T> T as(String token, Supplier<T> call) {
        TOKEN.set(token);
        try {
            return call.get();
        } finally {
            TOKEN.remove();
        }
    }

    private List<String> toolNames(String token) {
        return as(token, () -> client.listTools().tools().stream().map(McpSchema.Tool::name).sorted().toList());
    }

    private McpSchema.CallToolResult call(String token, String tool, Map<String, Object> arguments) {
        return as(token, () -> client.callTool(McpSchema.CallToolRequest.builder(tool).arguments(arguments).build()));
    }

    private static String text(McpSchema.CallToolResult result) {
        return ((McpSchema.TextContent) result.content().getFirst()).text();
    }

    @Test
    void eachRoleSeesOnlyItsTools() {
        assertThat(toolNames(TestTokens.token("CUSTOMER"))).containsExactly("booking_details", "cancellation_quote",
                "current_offers", "hotel_details", "my_bookings", "my_notifications", "my_payments",
                "my_support_tickets", "my_trip_summary", "search_flights", "search_hotels");
        assertThat(toolNames(TestTokens.token("ADMIN"))).containsExactly("admin_dashboard", "booking_details",
                "cancellation_quote", "run_report", "search_bookings", "search_payments", "search_refunds");
        assertThat(toolNames(TestTokens.token("HOTEL_MANAGER"))).containsExactly("hotel_arrivals_departures",
                "hotel_dashboard", "hotel_occupancy", "hotel_reservations", "my_hotels");
        assertThat(toolNames(TestTokens.token("SUPPORT_AGENT"))).containsExactly("booking_details",
                "cancellation_quote", "find_bookings", "ticket_metrics", "ticket_queue", "ticket_summary");
        assertThat(toolNames(null)).isEmpty();
    }

    @Test
    void everyToolIsReadOnlyAndDescribed() {
        List<McpSchema.Tool> tools = as(TestTokens.token("ADMIN"), () -> client.listTools().tools());

        assertThat(tools).allSatisfy(tool -> {
            assertThat(tool.annotations().readOnlyHint()).isTrue();
            assertThat(tool.annotations().destructiveHint()).isFalse();
            assertThat(tool.description()).isNotBlank();
            assertThat(tool.inputSchema()).containsEntry("type", "object");
        });
    }

    @Test
    void toolsCallTheGatewayWithTheUsersOwnToken() {
        String customer = TestTokens.token("CUSTOMER");
        gateway.on("/api/bookings", Answer.json("""
                {"content":[{"id":"0190aaaa-0000-7000-8000-000000000001","reference":"HT-7K3M9Q2X","type":"HOTEL",
                  "status":"CONFIRMED","paymentStatus":"PAID","title":"Sea Breeze Resort","destination":"Goa",
                  "startDate":"2026-12-01","endDate":"2026-12-03","totalAmount":6300.00,"currency":"INR"}],
                 "page":0,"size":10,"totalElements":1,"totalPages":1}
                """));

        McpSchema.CallToolResult result = call(customer, "my_bookings", Map.of("tab", "upcoming"));

        assertThat(result.isError()).isFalse();
        assertThat(text(result)).contains("HT-7K3M9Q2X").contains("₹6,300").doesNotContain("0190aaaa");
        assertThat(gateway.received()).singleElement().satisfies(request -> {
            assertThat(request.authorization()).isEqualTo("Bearer " + customer);
            assertThat(request.uri().getQuery()).contains("tab=UPCOMING");
        });
    }

    @Test
    void aCustomerCannotUseStaffTools() {
        McpSchema.CallToolResult result = call(TestTokens.token("CUSTOMER"), "admin_dashboard", Map.of());

        assertThat(result.isError()).isTrue();
        assertThat(text(result)).contains("NOT_ALLOWED");
        assertThat(gateway.received()).isEmpty();
    }

    @Test
    void anotherCustomersBookingIsNotFound() {
        gateway.on("/api/bookings", Answer.json("{\"content\":[],\"totalElements\":0}"));

        McpSchema.CallToolResult result = call(TestTokens.token("CUSTOMER"), "booking_details",
                Map.of("reference", "HT-B0B0B0B0"));

        assertThat(result.isError()).isTrue();
        assertThat(text(result)).contains("NOT_FOUND").contains("not allowed");
        assertThat(gateway.received()).allSatisfy(request -> assertThat(request.uri().getPath())
                .isEqualTo("/api/bookings"));
    }

    @Test
    void staffFindAnyBookingThroughTheSupportLookupAndPassportsStayMasked() {
        String agent = TestTokens.token("SUPPORT_AGENT");
        gateway.on("/api/support/bookings", Answer.json("""
                {"content":[{"id":"0190bbbb-0000-7000-8000-000000000002","reference":"FL-4KD8M2PQ"}],"totalElements":1}
                """));
        gateway.on("/api/bookings/0190bbbb-0000-7000-8000-000000000002", Answer.json("""
                {"reference":"FL-4KD8M2PQ","type":"FLIGHT","status":"CONFIRMED","currency":"INR","totalAmount":8450,
                 "contactEmail":"asha@example.com",
                 "flight":{"pnr":"K7QX2M","passengers":[{"firstName":"Asha","lastName":"Rao","passengerType":"ADULT",
                   "passportLast4":"4567","ticketNumber":"0981234567890"}]}}
                """));

        McpSchema.CallToolResult result = call(agent, "booking_details", Map.of("reference", "fl-4kd8m2pq"));

        assertThat(result.isError()).isFalse();
        assertThat(text(result)).contains("K7QX2M").contains("****4567").contains("asha@example.com")
                .doesNotContain("passportLast4");
        assertThat(gateway.received()).extracting(StubGateway.Received::authorization)
                .containsOnly("Bearer " + agent);
        assertThat(gateway.received().getFirst().uri().getQuery()).contains("q=FL-4KD8M2PQ");
    }

    @Test
    void invalidArgumentsNeverReachTheGateway() {
        McpSchema.CallToolResult result = call(TestTokens.token("CUSTOMER"), "booking_details",
                Map.of("reference", "' OR 1=1 --"));

        assertThat(result.isError()).isTrue();
        assertThat(text(result)).contains("INVALID_ARGUMENT");
        assertThat(gateway.received()).isEmpty();
    }

    @Test
    void theEndpointNeedsTheApiKeyAndAValidTokenIfOneIsSent() throws Exception {
        HttpClient http = HttpClient.newHttpClient();
        String body = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}";
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/mcp"))
                .header("Content-Type", "application/json").header("Accept", "application/json, text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(body));

        assertThat(http.send(request.copy().build(), HttpResponse.BodyHandlers.ofString()).statusCode())
                .isEqualTo(401);
        assertThat(http.send(request.copy().header("X-MCP-Api-Key", "wrong-key").build(),
                HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(401);
        assertThat(http.send(request.copy().header("X-MCP-Api-Key", API_KEY)
                .header("Authorization", "Bearer not.a.token").build(), HttpResponse.BodyHandlers.ofString())
                .statusCode()).isEqualTo(401);
        HttpResponse<String> ok = http.send(request.copy().header("X-MCP-Api-Key", API_KEY)
                .header("Authorization", "Bearer " + TestTokens.token("CUSTOMER")).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(ok.statusCode()).isEqualTo(200);
        assertThat(ok.body()).contains("my_bookings");
        // Nothing else is exposed.
        assertThat(http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/actuator/env"))
                .header("X-MCP-Api-Key", API_KEY).build(), HttpResponse.BodyHandlers.ofString()).statusCode())
                .isIn(401, 403, 404);
    }
}
