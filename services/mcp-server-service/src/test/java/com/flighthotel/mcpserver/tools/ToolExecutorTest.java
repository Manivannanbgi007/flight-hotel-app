package com.flighthotel.mcpserver.tools;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.mcpserver.gateway.DownstreamException;
import com.flighthotel.mcpserver.security.Caller;

import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.spec.McpSchema;
import io.modelcontextprotocol.spec.McpSchema.CallToolResult;
import tools.jackson.databind.json.JsonMapper;

/** Who may call a tool, and how every failure becomes a short, safe result for the model. */
class ToolExecutorTest {

    private final ToolExecutor executor = new ToolExecutor(JsonMapper.builder().build());

    private static Caller caller(String role) {
        return new Caller(new AuthenticatedUser(UUID.randomUUID(), "u@example.com", Set.of(role), Set.of(),
                Instant.now().plusSeconds(300)), "token-of-" + role);
    }

    private static McpTransportContext context(Caller caller) {
        return caller == null ? McpTransportContext.EMPTY
                : McpTransportContext.create(Map.of(Caller.CONTEXT_KEY, caller));
    }

    private static McpSchema.CallToolRequest request(Map<String, Object> arguments) {
        return McpSchema.CallToolRequest.builder("sample_tool").arguments(arguments).build();
    }

    private static String text(CallToolResult result) {
        return ((McpSchema.TextContent) result.content().getFirst()).text();
    }

    private static ToolDefinition tool(ToolDefinition.Handler handler) {
        return ToolDefinition.named("sample_tool").title("Sample").description("d").roles("ADMIN")
                .param(Param.integer("limit", "rows", 1, 5)).handler(handler);
    }

    @Test
    void theHandlerGetsTheCallerAndValidatedArguments() {
        AtomicReference<Caller> seen = new AtomicReference<>();
        Caller admin = caller("ADMIN");
        CallToolResult result = executor.call(tool((args, c) -> {
            seen.set(c);
            return Out.map("limit", args.integer("limit", 1), "items", List.of("a"));
        }), context(admin), request(Map.of("limit", 3)));

        assertThat(result.isError()).isFalse();
        assertThat(text(result)).isEqualTo("{\"limit\":3,\"items\":[\"a\"]}");
        assertThat(seen.get()).isSameAs(admin);
    }

    @Test
    void otherRolesAreRefusedEvenWhenTheyCallAHiddenToolByName() {
        CallToolResult result = executor.call(tool((args, c) -> Map.of("secret", 1)), context(caller("CUSTOMER")),
                request(Map.of()));

        assertThat(result.isError()).isTrue();
        assertThat(text(result)).contains("NOT_ALLOWED").doesNotContain("secret");
    }

    @Test
    void withoutASignedInUserNothingRuns() {
        CallToolResult result = executor.call(tool((args, c) -> Map.of("secret", 1)), context(null),
                request(Map.of()));

        assertThat(result.isError()).isTrue();
        assertThat(text(result)).contains("NOT_SIGNED_IN");
    }

    @Test
    void invalidArgumentsAreExplainedWithoutEchoingThem() {
        CallToolResult result = executor.call(tool((args, c) -> Map.of()), context(caller("ADMIN")),
                request(Map.of("limit", 99)));

        assertThat(result.isError()).isTrue();
        assertThat(text(result)).isEqualTo(
                "{\"error\":\"INVALID_ARGUMENT\",\"message\":\"limit must be between 1 and 5.\"}");
    }

    @ParameterizedTest
    @CsvSource({
            "401, NOT_FOUND", "403, NOT_FOUND", "404, NOT_FOUND",
            "400, INVALID_ARGUMENT", "409, INVALID_ARGUMENT", "422, INVALID_ARGUMENT",
            "429, BUSY", "500, UNAVAILABLE", "503, UNAVAILABLE"
    })
    void downstreamErrorsAreMappedWithoutLeakingDetails(int status, String code) {
        CallToolResult result = executor.call(tool((args, c) -> {
            throw new DownstreamException(DownstreamException.kindOf(status), status, "SOME_CODE",
                    "booking 0190 of someone@else.com");
        }), context(caller("ADMIN")), request(Map.of()));

        assertThat(result.isError()).isTrue();
        assertThat(text(result)).contains("\"error\":\"" + code + "\"").doesNotContain("someone@else.com")
                .doesNotContain(String.valueOf(status));
    }

    @Test
    void notFoundAndNotAllowedReadTheSame() {
        String forbidden = text(ToolExecutor.downstreamError(new DownstreamException(
                DownstreamException.Kind.NOT_FOUND_OR_NOT_ALLOWED, 403, "FORBIDDEN", "x")));
        String missing = text(ToolExecutor.downstreamError(new DownstreamException(
                DownstreamException.Kind.NOT_FOUND_OR_NOT_ALLOWED, 404, "BOOKING_NOT_FOUND", "x")));

        assertThat(forbidden).isEqualTo(missing);
    }

    @Test
    void toolFailuresKeepTheirMessageAndUnexpectedErrorsAreGeneric() {
        CallToolResult failure = executor.call(tool((args, c) -> {
            throw new ToolFailure("NOT_FOUND", "No booking HT-7K3M9Q2X was found for you.");
        }), context(caller("ADMIN")), request(Map.of()));
        CallToolResult crash = executor.call(tool((args, c) -> {
            throw new IllegalStateException("internal detail jdbc:mysql://secret");
        }), context(caller("ADMIN")), request(Map.of()));

        assertThat(text(failure)).contains("NOT_FOUND").contains("HT-7K3M9Q2X");
        assertThat(text(crash)).contains("FAILED").doesNotContain("jdbc");
    }
}
