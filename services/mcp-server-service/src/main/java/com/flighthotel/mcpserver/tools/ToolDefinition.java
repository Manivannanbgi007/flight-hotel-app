package com.flighthotel.mcpserver.tools;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.flighthotel.mcpserver.security.Caller;

/**
 * One read-only tool: its name, the roles that may see and call it, its parameters and its handler. The handler
 * returns a small JSON-friendly object (maps, lists, strings, numbers) with only the fields the model needs.
 */
public record ToolDefinition(String name, String title, String description, Set<String> roles, List<Param> params,
        Handler handler) {

    @FunctionalInterface
    public interface Handler {
        Object handle(Args args, Caller caller);
    }

    public ToolDefinition {
        if (!name.matches("[a-z][a-z0-9_]{2,40}")) {
            throw new IllegalArgumentException("Tool names are snake_case: " + name);
        }
        roles = Set.copyOf(roles);
        params = List.copyOf(params);
    }

    public static Builder named(String name) {
        return new Builder(name);
    }

    /** The JSON schema of the arguments. */
    public Map<String, Object> inputSchema() {
        Map<String, Object> properties = new LinkedHashMap<>();
        List<String> required = new ArrayList<>();
        for (Param param : params) {
            properties.put(param.name(), param.schema());
            if (param.isRequired()) {
                required.add(param.name());
            }
        }
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("properties", properties);
        if (!required.isEmpty()) {
            schema.put("required", required);
        }
        schema.put("additionalProperties", false);
        return schema;
    }

    /** Validates every argument; unknown arguments are ignored (small models sometimes add extra ones). */
    public Args validate(Map<String, Object> arguments) {
        Map<String, Object> values = new LinkedHashMap<>();
        Map<String, Object> given = arguments == null ? Map.of() : arguments;
        for (Param param : params) {
            values.put(param.name(), param.validate(given.get(param.name())));
        }
        return new Args(values);
    }

    public static final class Builder {

        private final String name;
        private String title;
        private String description;
        private Set<String> roles = Set.of();
        private final List<Param> params = new ArrayList<>();

        private Builder(String name) {
            this.name = name;
        }

        public Builder title(String title) {
            this.title = title;
            return this;
        }

        public Builder description(String description) {
            this.description = description;
            return this;
        }

        public Builder roles(String... roles) {
            this.roles = Set.of(roles);
            return this;
        }

        public Builder param(Param param) {
            this.params.add(param);
            return this;
        }

        public ToolDefinition handler(Handler handler) {
            return new ToolDefinition(name, title, description, roles, params, handler);
        }
    }
}
