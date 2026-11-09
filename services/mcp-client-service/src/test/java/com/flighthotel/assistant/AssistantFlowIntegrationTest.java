package com.flighthotel.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.flighthotel.assistant.Stubs.Ollama.Reply;
import com.flighthotel.assistant.grounding.GroundingGuard;

import tools.jackson.databind.JsonNode;

/**
 * The chat flow end to end over real HTTP, with a stub Ollama and a stub MCP server: the SSE events, tool calls with
 * the user's own token, the grounding check, conversation memory and ownership, and the error paths.
 */
class AssistantFlowIntegrationTest extends AssistantIntegrationTest {

    @BeforeEach
    void script() {
        // First a tool call, then an answer once the tool result is in the conversation.
        OLLAMA.script = request -> Stubs.Ollama.toolMessages(request).isEmpty()
                ? Reply.tool("my_bookings", Map.of("tab", "UPCOMING"))
                : Reply.text("Your trip ", "HT-7K3M9Q2X ", "costs ", "₹6,300.");
    }

    @Test
    void configSaysWhatIsAvailable() throws Exception {
        HttpResponse<String> response = send("GET", "/api/assistant/config", TestTokens.token("CUSTOMER"));

        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode config = JSON.readTree(response.body());
        assertThat(config.path("enabled").asBoolean()).isTrue();
        assertThat(config.path("model").asString()).isEqualTo("test-model");
        assertThat(config.path("voice").path("transcription").asBoolean()).isTrue();
        assertThat(config.path("voice").path("speech").asBoolean()).isTrue();
        assertThat(config.path("limits").path("maxMessageLength").asInt()).isEqualTo(2000);
    }

    @Test
    void theAssistantIsOffWithoutTheModelOrWithoutToolCalling() throws Exception {
        String token = TestTokens.token("CUSTOMER");
        OLLAMA.model = "another-model";
        assertThat(JSON.readTree(send("GET", "/api/assistant/config", token).body()).path("enabled").asBoolean())
                .isFalse();
        SseClient.Result refused = chat(token, "hello", null);
        assertThat(refused.status()).isEqualTo(503);
        assertThat(refused.body()).contains("ASSISTANT_UNAVAILABLE");

        OLLAMA.model = "test-model";
        OLLAMA.capabilities = List.of("completion");
        status.invalidate();
        assertThat(JSON.readTree(send("GET", "/api/assistant/config", token).body()).path("enabled").asBoolean())
                .isFalse();
    }

    @Test
    void anAnswerStreamsWithStatusSourcesAndTheUsersOwnToken() throws Exception {
        String token = TestTokens.token("CUSTOMER");

        SseClient.Result result = chat(token, "What are my upcoming trips?", null);

        assertThat(result.status()).isEqualTo(200);
        assertThat(result.names().getFirst()).isEqualTo("conversation");
        assertThat(result.names()).containsSubsequence("conversation", "status", "status", "delta", "done");
        assertThat(result.named("status").get(1).data().path("tool").asString()).isEqualTo("my_bookings");
        assertThat(result.named("status").get(1).data().path("text").asString()).isEqualTo("Looking up your trips…");
        assertThat(result.answer()).isEqualTo("Your trip HT-7K3M9Q2X costs ₹6,300.");
        JsonNode done = result.last().data();
        assertThat(result.last().name()).isEqualTo("done");
        assertThat(done.path("grounded").asBoolean()).isTrue();
        assertThat(done.path("sources").get(0).path("tool").asString()).isEqualTo("my_bookings");
        assertThat(done.path("sources").get(0).path("label").asString()).isEqualTo("Your trips");

        // The MCP server got the internal key on every request and the user's own token on the user's calls.
        assertThat(MCP.calls).allSatisfy(call -> assertThat(call.apiKey()).isEqualTo(API_KEY));
        assertThat(MCP.calls.stream().filter(call -> call.method().startsWith("tools/")))
                .isNotEmpty().allSatisfy(call -> assertThat(call.authorization()).isEqualTo("Bearer " + token));
        assertThat(MCP.toolCalls()).singleElement().satisfies(call -> {
            assertThat(call.tool()).isEqualTo("my_bookings");
            assertThat(call.arguments().path("tab").asString()).isEqualTo("UPCOMING");
        });
        // The model saw the customer prompt and the tool result, never the token.
        assertThat(OLLAMA.chatRequests).hasSize(2);
        String secondRequest = OLLAMA.chatRequests.get(1).toString();
        assertThat(secondRequest).contains("The user is a customer").contains("HT-7K3M9Q2X").doesNotContain(token);
        assertThat(OLLAMA.chatRequests.getFirst().path("tools")).isNotEmpty();
    }

    @Test
    void conversationsAreRememberedAndOnlyForTheirOwner() throws Exception {
        UUID ownerId = UUID.randomUUID();
        String owner = TestTokens.token(ownerId, "CUSTOMER", java.time.Instant.now().plusSeconds(300));
        String conversationId = chat(owner, "What are my upcoming trips?", null).events().getFirst().data()
                .path("id").asString();

        // A follow-up continues the same conversation, and the model gets the history.
        SseClient.Result followUp = chat(owner, "And the price?", conversationId);
        assertThat(followUp.events().getFirst().data().path("id").asString()).isEqualTo(conversationId);
        assertThat(OLLAMA.chatRequests.getLast().toString()).contains("What are my upcoming trips?");

        HttpResponse<String> mine = send("GET", "/api/assistant/conversations/" + conversationId, owner);
        assertThat(mine.statusCode()).isEqualTo(200);
        JsonNode messages = JSON.readTree(mine.body()).path("messages");
        assertThat(messages.size()).isEqualTo(4);
        assertThat(messages.get(0).path("role").asString()).isEqualTo("user");
        assertThat(messages.get(1).path("role").asString()).isEqualTo("assistant");
        assertThat(messages.get(1).path("sources").get(0).path("tool").asString()).isEqualTo("my_bookings");
        Long ttl = redisTemplate.getExpire("assistant:conversation:" + conversationId);
        assertThat(ttl).isBetween(Duration.ofHours(23).toSeconds(), Duration.ofHours(24).toSeconds());

        String stranger = TestTokens.token("CUSTOMER");
        assertThat(send("GET", "/api/assistant/conversations/" + conversationId, stranger).statusCode())
                .isEqualTo(404);
        assertThat(send("DELETE", "/api/assistant/conversations/" + conversationId, stranger).statusCode())
                .isEqualTo(404);
        SseClient.Result hijack = chat(stranger, "What did I ask before?", conversationId);
        assertThat(hijack.status()).isEqualTo(404);
        assertThat(hijack.body()).contains("CONVERSATION_NOT_FOUND");

        assertThat(send("DELETE", "/api/assistant/conversations/" + conversationId, owner).statusCode())
                .isEqualTo(204);
        assertThat(send("GET", "/api/assistant/conversations/" + conversationId, owner).statusCode())
                .isEqualTo(404);
    }

    @Test
    void anInventedReferenceOrAmountIsNeverShown() throws Exception {
        OLLAMA.script = request -> Stubs.Ollama.toolMessages(request).isEmpty()
                ? Reply.tool("my_bookings", Map.of())
                : Reply.text("Your booking ", "HT-AAAA2222 ", "is confirmed ", "and costs ", "₹9,999 ", "in total.");
        String token = TestTokens.token("CUSTOMER");

        SseClient.Result result = chat(token, "What are my upcoming trips?", null);

        assertThat(result.answer()).isEqualTo(GroundingGuard.SAFE_ANSWER);
        assertThat(result.named("delta")).allSatisfy(delta -> assertThat(delta.data().path("text").asString())
                .doesNotContain("HT-AAAA2222").doesNotContain("9,999"));
        assertThat(result.named("delta").getLast().data().path("replace").asBoolean()).isTrue();
        assertThat(result.last().data().path("grounded").asBoolean()).isFalse();
        String conversationId = result.events().getFirst().data().path("id").asString();
        JsonNode saved = JSON.readTree(send("GET", "/api/assistant/conversations/" + conversationId, token).body());
        assertThat(saved.path("messages").get(1).path("text").asString()).isEqualTo(GroundingGuard.SAFE_ANSWER);
        assertThat(saved.path("messages").get(1).path("grounded").asBoolean()).isFalse();
    }

    @Test
    void aModelFailureEndsWithAClearErrorEvent() throws Exception {
        OLLAMA.script = request -> Reply.error(500);

        SseClient.Result result = chat(TestTokens.token("CUSTOMER"), "hello", null);

        assertThat(result.status()).isEqualTo(200);
        assertThat(result.last().name()).isEqualTo("error");
        assertThat(result.last().data().path("code").asString()).isEqualTo("ASSISTANT_UNAVAILABLE");
        assertThat(result.last().data().path("message").asString()).isNotBlank();
    }

    @Test
    void anUnreachableToolServerEndsWithDataUnavailable() throws Exception {
        MCP.failStatus = 503;

        SseClient.Result result = chat(TestTokens.token("ADMIN"), "How many bookings this month?", null);

        assertThat(result.last().name()).isEqualTo("error");
        assertThat(result.last().data().path("code").asString()).isEqualTo("DATA_UNAVAILABLE");
        assertThat(OLLAMA.chatRequests).isEmpty();
    }

    @Test
    void aToolErrorIsExplainedByTheModelNotHidden() throws Exception {
        MCP.results = (tool, authorization) -> "{\"error\":\"NOT_FOUND\",\"message\":\"No booking HT-ZZ9ZZ9ZZ was "
                + "found for you, or you are not allowed to see it.\"}";
        OLLAMA.script = request -> Stubs.Ollama.toolMessages(request).isEmpty()
                ? Reply.tool("booking_details", Map.of("reference", "HT-ZZ9ZZ9ZZ"))
                : Reply.text("I could not find booking HT-ZZ9ZZ9ZZ for you.");

        SseClient.Result result = chat(TestTokens.token("CUSTOMER"), "Details of HT-ZZ9ZZ9ZZ?", null);

        assertThat(result.answer()).isEqualTo("I could not find booking HT-ZZ9ZZ9ZZ for you.");
        assertThat(result.last().data().path("grounded").asBoolean()).isTrue();
    }

    @Test
    void invalidRequestsAndBusyUsersAreRefusedBeforeTheStream() throws Exception {
        String token = TestTokens.token("CUSTOMER");
        assertThat(chat(token, "", null).status()).isEqualTo(400);
        assertThat(chat(token, "x".repeat(2001), null).status()).isEqualTo(400);
        SseClient.Result badId = SseClient.post(url("/api/assistant/chat"), token,
                "{\"message\":\"hi\",\"conversationId\":\"../../etc\"}");
        assertThat(badId.status()).isEqualTo(400);
        assertThat(badId.body()).contains("VALIDATION_FAILED");
        SseClient.Result unknown = chat(token, "hi", UUID.randomUUID().toString());
        assertThat(unknown.status()).isEqualTo(404);
        assertThat(chat(null, "hi", null).status()).isEqualTo(401);

        UUID busyUser = UUID.randomUUID();
        redisTemplate.opsForValue().set("assistant:chat-lock:" + busyUser, "other", Duration.ofMinutes(1));
        SseClient.Result busy = chat(TestTokens.token(busyUser, "CUSTOMER", java.time.Instant.now().plusSeconds(60)),
                "hi", null);
        assertThat(busy.status()).isEqualTo(409);
        assertThat(busy.body()).contains("CHAT_IN_PROGRESS");
    }

    @Test
    void concurrentUsersEachUseTheirOwnToken() throws Exception {
        // The tool result names the token it was called with; the model repeats the tool result.
        MCP.results = (tool, authorization) -> "{\"owner\":\"" + authorization.substring(authorization.length() - 12)
                + "\"}";
        OLLAMA.script = request -> {
            List<String> tools = Stubs.Ollama.toolMessages(request);
            if (tools.isEmpty()) {
                return Reply.tool("my_bookings", Map.of());
            }
            return Reply.text("Result: " + tools.getLast());
        };
        List<String> tokens = List.of(TestTokens.token("CUSTOMER"), TestTokens.token("CUSTOMER"),
                TestTokens.token("CUSTOMER"), TestTokens.token("CUSTOMER"), TestTokens.token("ADMIN"),
                TestTokens.token("SUPPORT_AGENT"));
        ExecutorService pool = Executors.newFixedThreadPool(tokens.size());
        try {
            List<Callable<SseClient.Result>> chats = tokens.stream()
                    .<Callable<SseClient.Result>>map(token -> () -> chat(token, "my trips", null)).toList();
            List<Future<SseClient.Result>> results = pool.invokeAll(chats);
            for (int i = 0; i < tokens.size(); i++) {
                String token = tokens.get(i);
                SseClient.Result result = results.get(i).get();
                assertThat(result.answer()).as("user %d", i).contains(token.substring(token.length() - 12));
                tokens.stream().filter(other -> !other.equals(token)).forEach(other -> assertThat(result.answer())
                        .doesNotContain(other.substring(other.length() - 12)));
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(MCP.toolCalls()).hasSize(tokens.size());
        assertThat(MCP.toolCalls().stream().map(Stubs.McpServer.Call::authorization).distinct().count())
                .isEqualTo(tokens.size());
    }
}
