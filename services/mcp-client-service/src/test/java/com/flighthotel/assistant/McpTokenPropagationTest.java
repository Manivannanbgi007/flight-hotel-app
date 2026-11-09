package com.flighthotel.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.Test;

import com.flighthotel.assistant.tools.McpToolGateway;

/**
 * The user's token reaches the MCP server on exactly that user's call, also when many users call at the same time
 * on many threads (the token travels in the MCP transport context of each call, set around the synchronous call).
 */
class McpTokenPropagationTest extends AssistantIntegrationTest {

    @Test
    void manyParallelCallsEachCarryTheirOwnToken() throws Exception {
        MCP.results = (tool, authorization) -> "{\"seenBy\":\"" + authorization + "\"}";
        int users = 24;
        ExecutorService pool = Executors.newFixedThreadPool(12);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Callable<String[]>> calls = new ArrayList<>();
            for (int i = 0; i < users; i++) {
                String token = "user-token-" + i + "-" + "x".repeat(i);
                calls.add(() -> {
                    start.await();
                    McpToolGateway.ToolResult result = toolGateway.call("my_bookings", Map.of("marker", token), token,
                            null);
                    return new String[] {token, result.text()};
                });
            }
            List<Future<String[]>> futures = new ArrayList<>();
            for (Callable<String[]> call : calls) {
                futures.add(pool.submit(call));
            }
            start.countDown();
            for (Future<String[]> future : futures) {
                String[] outcome = future.get();
                assertThat(outcome[1]).isEqualTo("{\"seenBy\":\"Bearer " + outcome[0] + "\"}");
            }
        } finally {
            pool.shutdownNow();
        }
        // The server saw each call with the token that belongs to its marker.
        assertThat(MCP.toolCalls()).hasSize(users).allSatisfy(call -> assertThat(call.authorization())
                .isEqualTo("Bearer " + call.arguments().path("marker").asString()));
    }

    @Test
    void callsOutsideAUserContextCarryNoToken() {
        MCP.results = (tool, authorization) -> "{\"seenBy\":\"" + authorization + "\"}";

        assertThat(toolGateway.call("my_bookings", Map.of(), null, null).text()).isEqualTo("{\"seenBy\":\"null\"}");
    }
}
