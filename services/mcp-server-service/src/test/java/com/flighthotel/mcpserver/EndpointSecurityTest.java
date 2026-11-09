package com.flighthotel.mcpserver;

import static com.flighthotel.testsupport.RoleTokens.ADMIN;
import static com.flighthotel.testsupport.RoleTokens.CUSTOMER;
import static com.flighthotel.testsupport.RoleTokens.HOTEL_MANAGER;
import static com.flighthotel.testsupport.RoleTokens.SUPPORT_AGENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.assertj.core.api.SoftAssertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.flighthotel.testsupport.Endpoints;
import com.flighthotel.testsupport.RoleTokens;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Who may use what (SECURITY_GUIDE.md, AI_ASSISTANT.md §Security). This service has no REST endpoints, only the MCP
 * endpoint, so the access matrix is checked per tool: with the real permissions of each role ({@link RoleTokens}),
 * {@code tools/list} shows exactly the role's tools and every other tool is refused when called by name.
 */
@SpringBootTest(properties = {
        "spring.data.redis.port=6399",
        "mcp-server.api-key=" + EndpointSecurityTest.API_KEY,
        "mcp-server.gateway.url=http://127.0.0.1:9"
})
@AutoConfigureMockMvc
@Import(TestTokens.LocalKeys.class)
class EndpointSecurityTest {

    static final String API_KEY = "endpoint-security-test-key-0123456789abcdef";

    private static final Map<String, Set<String>> TOOLS = Map.of(
            CUSTOMER, Set.of("my_bookings", "booking_details", "cancellation_quote", "my_trip_summary", "my_payments",
                    "my_support_tickets", "my_notifications", "search_hotels", "hotel_details", "search_flights",
                    "current_offers"),
            ADMIN, Set.of("admin_dashboard", "search_bookings", "search_payments", "search_refunds", "run_report",
                    "booking_details", "cancellation_quote"),
            HOTEL_MANAGER, Set.of("my_hotels", "hotel_dashboard", "hotel_arrivals_departures", "hotel_reservations",
                    "hotel_occupancy"),
            SUPPORT_AGENT, Set.of("ticket_queue", "ticket_summary", "ticket_metrics", "find_bookings", "booking_details",
                    "cancellation_quote"));

    private final JsonMapper json = JsonMapper.builder().build();

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ApplicationContext context;

    private static MockHttpServletRequestBuilder mcp(String method, String params) {
        return post("/mcp").contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON, MediaType.TEXT_EVENT_STREAM)
                .content("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"" + method + "\",\"params\":" + params + "}");
    }

    private JsonNode result(MockHttpServletResponse response) throws Exception {
        assertThat(response.getStatus()).isEqualTo(200);
        return json.readTree(response.getContentAsString()).path("result");
    }

    @Test
    void theOnlyEntryPointIsTheMcpEndpoint() throws Exception {
        assertThat(Endpoints.of(context)).as("REST endpoints of this service").isEmpty();
        assertThat(mockMvc.perform(get("/v3/api-docs").with(RoleTokens.as(ADMIN))).andReturn().getResponse()
                .getStatus()).isIn(403, 404);
        assertThat(mockMvc.perform(get("/actuator/health")).andReturn().getResponse().getStatus()).isNotIn(401, 403);
    }

    @Test
    void withoutTheInternalKeyNoRoleGetsIn() throws Exception {
        for (String role : TOOLS.keySet()) {
            MockHttpServletResponse response = mockMvc.perform(mcp("tools/list", "{}").with(RoleTokens.as(role)))
                    .andReturn().getResponse();
            assertThat(response.getStatus()).as(role).isEqualTo(401);
            assertThat(response.getContentAsString()).contains("INVALID_API_KEY").doesNotContain("my_bookings");
        }
    }

    @Test
    void withoutALoginNoToolIsListedOrRuns() throws Exception {
        JsonNode list = result(mockMvc.perform(mcp("tools/list", "{}").header("X-MCP-Api-Key", API_KEY))
                .andReturn().getResponse());
        assertThat(list.path("tools").size()).isZero();

        JsonNode call = result(mockMvc.perform(mcp("tools/call", "{\"name\":\"my_bookings\",\"arguments\":{}}")
                .header("X-MCP-Api-Key", API_KEY)).andReturn().getResponse());
        assertThat(call.path("isError").asBoolean()).isTrue();
        assertThat(call.toString()).contains("NOT_SIGNED_IN");
    }

    @Test
    void eachRoleSeesExactlyItsToolsAndIsRefusedTheOthers() throws Exception {
        Set<String> allTools = new TreeSet<>();
        TOOLS.values().forEach(allTools::addAll);
        SoftAssertions softly = new SoftAssertions();
        for (Map.Entry<String, Set<String>> entry : TOOLS.entrySet()) {
            String role = entry.getKey();
            JsonNode list = result(mockMvc.perform(mcp("tools/list", "{}").header("X-MCP-Api-Key", API_KEY)
                    .with(RoleTokens.as(role))).andReturn().getResponse());
            List<String> listed = new ArrayList<>();
            list.path("tools").forEach(tool -> listed.add(tool.path("name").asString()));
            softly.assertThat(new TreeSet<>(listed)).as("tools of %s", role).isEqualTo(new TreeSet<>(entry.getValue()));

            for (String tool : allTools) {
                if (entry.getValue().contains(tool)) {
                    continue;
                }
                JsonNode call = result(mockMvc.perform(mcp("tools/call",
                        "{\"name\":\"" + tool + "\",\"arguments\":{\"reference\":\"HT-7K3M9Q2X\"}}")
                        .header("X-MCP-Api-Key", API_KEY).with(RoleTokens.as(role))).andReturn().getResponse());
                softly.assertThat(call.path("isError").asBoolean()).as("%s calling %s", role, tool).isTrue();
                softly.assertThat(call.toString()).as("%s calling %s", role, tool).contains("NOT_ALLOWED");
            }
        }
        softly.assertAll();
    }
}
