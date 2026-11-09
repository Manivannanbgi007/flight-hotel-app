package com.flighthotel.mcpserver.config;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.springframework.ai.mcp.customizer.McpStatelessSyncServerCustomizer;
import org.springframework.ai.mcp.server.webmvc.transport.WebMvcStatelessServerTransport;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.flighthotel.mcpserver.security.Caller;
import com.flighthotel.mcpserver.tools.ToolDefinition;
import com.flighthotel.mcpserver.tools.ToolExecutor;
import com.flighthotel.mcpserver.tools.ToolSet;

import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.json.jackson3.JacksonMcpJsonMapper;
import io.modelcontextprotocol.server.McpStatelessServerFeatures.SyncToolSpecification;
import io.modelcontextprotocol.spec.McpSchema;
import tools.jackson.databind.json.JsonMapper;

/**
 * The MCP server: stateless Streamable HTTP on {@code /mcp} (every POST stands alone, no session), so the user's
 * token can be checked on every request and any instance can answer.
 * <ul>
 * <li>The transport copies the already validated user ({@link Caller}) from Spring Security into the MCP transport
 * context; the tool handlers read it from there.</li>
 * <li>{@code tools/list} only shows the tools of the caller's roles; every tool checks the role again when called
 * (a hidden tool can still be called by name).</li>
 * </ul>
 */
@Configuration
public class McpToolServerConfig {

    /** Replaces Spring AI's default transport to add the caller to the context of every request. */
    @Bean
    WebMvcStatelessServerTransport webMvcStatelessServerTransport(
            @Qualifier("mcpServerJsonMapper") JsonMapper mcpJsonMapper,
            @Value("${spring.ai.mcp.server.streamable-http.mcp-endpoint:/mcp}") String mcpEndpoint) {
        return WebMvcStatelessServerTransport.builder()
                .jsonMapper(new JacksonMcpJsonMapper(mcpJsonMapper))
                .messageEndpoint(mcpEndpoint)
                // Runs on the servlet thread after the security filters, so the validated token is there.
                .contextExtractor(request -> Caller.fromSecurityContext()
                        .map(caller -> McpTransportContext.create(Map.of(Caller.CONTEXT_KEY, caller)))
                        .orElse(McpTransportContext.EMPTY))
                .build();
    }

    @Bean
    List<SyncToolSpecification> assistantTools(List<ToolSet> toolSets, ToolExecutor executor) {
        return allTools(toolSets).stream()
                .map(tool -> SyncToolSpecification.builder()
                        .tool(McpSchema.Tool.builder(tool.name(), tool.inputSchema())
                                .title(tool.title())
                                .description(tool.description())
                                .annotations(McpSchema.ToolAnnotations.builder()
                                        .title(tool.title())
                                        .readOnlyHint(true)
                                        .destructiveHint(false)
                                        .idempotentHint(true)
                                        .openWorldHint(false)
                                        .build())
                                .meta(Map.of("roles", new TreeSet<>(tool.roles())))
                                .build())
                        .callHandler((context, request) -> executor.call(tool, context, request))
                        .build())
                .toList();
    }

    /**
     * {@code tools/list}: a tool is listed only for callers with one of its roles (nothing without a login).
     * <p>
     * The SDK's own JSON-schema check of the arguments is switched off: {@link ToolExecutor} checks the role first
     * and then validates with the same rules, tolerates extra arguments that small models add, and never logs the
     * values (the SDK check would log them and answer before the role check).
     */
    @Bean
    McpStatelessSyncServerCustomizer roleBasedToolList(List<ToolSet> toolSets) {
        Map<String, Set<String>> rolesByTool = new HashMap<>();
        allTools(toolSets).forEach(tool -> rolesByTool.put(tool.name(), tool.roles()));
        return server -> server.validateToolInputs(false)
                .addToolFilter((context, tool) -> Caller.from(context)
                        .map(caller -> caller.hasAnyRole(rolesByTool.getOrDefault(tool.name(), Set.of())))
                        .orElse(false));
    }

    static List<ToolDefinition> allTools(List<ToolSet> toolSets) {
        List<ToolDefinition> tools = toolSets.stream().flatMap(set -> set.tools().stream())
                .sorted(Comparator.comparing(ToolDefinition::name)).toList();
        Set<String> names = new java.util.HashSet<>();
        for (ToolDefinition tool : tools) {
            if (!names.add(tool.name())) {
                throw new IllegalStateException("Duplicate tool name " + tool.name());
            }
        }
        return tools;
    }
}
