package com.flighthotel.assistant.tools;

import java.util.Locale;
import java.util.Map;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.model.ToolContext;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.DefaultToolDefinition;
import org.springframework.ai.tool.definition.ToolDefinition;

import com.flighthotel.assistant.blocks.ToolRun;
import com.flighthotel.assistant.chat.ChatEvent;
import com.flighthotel.assistant.chat.Turn;

import io.modelcontextprotocol.spec.McpSchema;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * One MCP tool offered to the model for one question. When the model calls it:
 * <ol>
 * <li>a {@code status} event tells the UI what is being looked up;</li>
 * <li>the MCP server is called <b>with the user's token</b> (from the {@link Turn} in the {@code ToolContext});</li>
 * <li>the result is added to the turn's facts (grounding check) and the tool to the answer's sources;</li>
 * <li>the result text (or a JSON error) goes back to the model.</li>
 * </ol>
 * Too many calls in one question, or an unreachable server, give the model a short error it can explain. Arguments
 * and results are never logged.
 */
public class AssistantToolCallback implements ToolCallback {

    private static final Logger log = LoggerFactory.getLogger(AssistantToolCallback.class);
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {
    };

    private final McpSchema.Tool tool;
    private final ToolDefinition definition;
    private final McpToolGateway gateway;
    private final JsonMapper jsonMapper;
    private final int maxToolCalls;

    public AssistantToolCallback(McpSchema.Tool tool, McpToolGateway gateway, JsonMapper jsonMapper,
            int maxToolCalls) {
        this.tool = tool;
        this.gateway = gateway;
        this.jsonMapper = jsonMapper;
        this.maxToolCalls = maxToolCalls;
        this.definition = DefaultToolDefinition.builder()
                .name(tool.name())
                .description(tool.description() == null ? tool.name() : tool.description())
                .inputSchema(jsonMapper.writeValueAsString(tool.inputSchema()))
                .build();
    }

    @Override
    public ToolDefinition getToolDefinition() {
        return definition;
    }

    /** A label for people, e.g. "Your trips". */
    public String label() {
        return tool.title() != null ? tool.title() : tool.name().replace('_', ' ');
    }

    @Override
    public String call(String toolInput) {
        throw new IllegalStateException("Assistant tools need the turn in the tool context");
    }

    @Override
    public String call(String toolInput, @Nullable ToolContext toolContext) {
        if (toolContext == null || !(toolContext.getContext().get(Turn.CONTEXT_KEY) instanceof Turn turn)) {
            throw new IllegalStateException("Assistant tools need the turn in the tool context");
        }
        long start = System.nanoTime();
        String outcome = "ok";
        try {
            if (turn.nextToolCall() > maxToolCalls) {
                outcome = "limit";
                return error("TOO_MANY_LOOKUPS", "No more lookups for this question. Answer with what you have.");
            }
            turn.emit(new ChatEvent.Status(statusText(), tool.name()));
            Map<String, Object> arguments;
            try {
                arguments = toolInput == null || toolInput.isBlank() ? Map.of()
                        : jsonMapper.readValue(toolInput, MAP);
            } catch (RuntimeException ex) {
                outcome = "bad_arguments";
                return error("INVALID_ARGUMENT", "The arguments were not valid JSON.");
            }
            McpToolGateway.ToolResult result = gateway.call(tool.name(), arguments, turn.accessToken(),
                    turn.correlationId());
            turn.facts().addFromToolResult(result.text());
            turn.used(tool.name(), label());
            recordRun(turn, result);
            outcome = result.error() ? "tool_error" : "ok";
            return result.text();
        } catch (RuntimeException ex) {
            outcome = "unavailable";
            log.warn("MCP tool call failed: tool={} error={}", tool.name(), ex.getClass().getSimpleName());
            return error("UNAVAILABLE", "This information is temporarily unavailable. Try again later.");
        } finally {
            log.info("Assistant tool call: conversation={} tool={} outcome={} durationMs={}", turn.conversationId(),
                    tool.name(), outcome, (System.nanoTime() - start) / 1_000_000);
        }
    }

    /** Keeps the result (as data) for the cards of the answer; a result that is not JSON just gets no card. */
    private void recordRun(Turn turn, McpToolGateway.ToolResult result) {
        try {
            Map<String, Object> parsed = jsonMapper.readValue(result.text(), MAP);
            turn.record(new ToolRun(tool.name(), parsed, result.error()));
        } catch (RuntimeException ex) {
            log.debug("Tool result is not JSON, no card: tool={}", tool.name());
        }
    }

    private String statusText() {
        String label = label();
        return "Looking up " + (label.isEmpty() ? label
                : label.substring(0, 1).toLowerCase(Locale.ROOT) + label.substring(1)) + "…";
    }

    private static String error(String code, String message) {
        return "{\"error\":\"" + code + "\",\"message\":\"" + message + "\"}";
    }
}
