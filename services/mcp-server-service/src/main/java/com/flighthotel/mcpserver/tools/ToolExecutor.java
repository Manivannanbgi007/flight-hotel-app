package com.flighthotel.mcpserver.tools;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.flighthotel.mcpserver.gateway.DownstreamException;
import com.flighthotel.mcpserver.security.Caller;

import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.spec.McpSchema;
import io.modelcontextprotocol.spec.McpSchema.CallToolResult;
import tools.jackson.databind.json.JsonMapper;

/**
 * Runs one tool call: who is calling, may this role use the tool, are the arguments valid, then the handler. Every
 * failure becomes a short, safe tool result ({@code {"error": CODE, "message": ...}}, {@code isError = true}) that
 * the model can explain to the user. Logs carry the tool name, outcome and duration only, never arguments or data.
 */
@Component
public class ToolExecutor {

    private static final Logger log = LoggerFactory.getLogger(ToolExecutor.class);

    private final JsonMapper jsonMapper;

    public ToolExecutor(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    public CallToolResult call(ToolDefinition tool, McpTransportContext context, McpSchema.CallToolRequest request) {
        long start = System.nanoTime();
        String outcome = "ok";
        try {
            Caller caller = Caller.from(context).orElse(null);
            if (caller == null) {
                outcome = "not_signed_in";
                return error("NOT_SIGNED_IN", "You need to be signed in to use the assistant's data tools.");
            }
            if (!caller.hasAnyRole(tool.roles())) {
                outcome = "role_refused";
                return error("NOT_ALLOWED", "This information is not available for your role.");
            }
            Args args = tool.validate(request.arguments());
            Object result = tool.handler().handle(args, caller);
            return CallToolResult.builder()
                    .content(List.of(McpSchema.TextContent.builder(jsonMapper.writeValueAsString(result)).build()))
                    .isError(false)
                    .build();
        } catch (ToolInputException ex) {
            outcome = "invalid_argument";
            return error("INVALID_ARGUMENT", ex.getMessage() + ".");
        } catch (ToolFailure ex) {
            outcome = ex.code().toLowerCase();
            return error(ex.code(), ex.getMessage());
        } catch (DownstreamException ex) {
            outcome = "downstream_" + ex.kind().name().toLowerCase() + "_" + ex.status();
            return downstreamError(ex);
        } catch (RuntimeException ex) {
            outcome = "failed";
            log.error("Tool failed: tool={}", tool.name(), ex);
            return error("FAILED", "The tool failed. Try again later.");
        } finally {
            log.info("MCP tool call: tool={} outcome={} durationMs={}", tool.name(), outcome,
                    (System.nanoTime() - start) / 1_000_000);
        }
    }

    static CallToolResult downstreamError(DownstreamException ex) {
        return switch (ex.kind()) {
            case NOT_FOUND_OR_NOT_ALLOWED -> error("NOT_FOUND",
                    "Nothing was found, or you are not allowed to see it.");
            case REJECTED -> error("INVALID_ARGUMENT", "The request was refused"
                    + (ex.code() != null && ex.code().matches("[A-Z_]{3,60}") ? " (" + ex.code() + ")" : "")
                    + ". Check the filters, for example the dates.");
            case BUSY -> error("BUSY", "Too many requests right now. Try again in a moment.");
            case UNAVAILABLE -> error("UNAVAILABLE", "This information is temporarily unavailable. Try again later.");
        };
    }

    static CallToolResult error(String code, String message) {
        // Hand-written JSON keeps this static; the texts are ours (input in them was validated against a pattern).
        String json = "{\"error\":\"" + code + "\",\"message\":\"" + message.replace("\\", "\\\\").replace("\"", "\\\"")
                + "\"}";
        return CallToolResult.builder()
                .content(List.of(McpSchema.TextContent.builder(json).build()))
                .isError(true)
                .build();
    }
}
