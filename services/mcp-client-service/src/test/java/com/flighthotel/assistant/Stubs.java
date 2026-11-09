package com.flighthotel.assistant;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BiFunction;
import java.util.function.Function;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Local HTTP servers that answer like Ollama, the MCP server and the speech server (the pattern of
 * RazorpayPaymentProviderTest). Each records what it received, so tests can check tokens and prompts.
 */
public final class Stubs {

    static final JsonMapper JSON = JsonMapper.builder().build();

    private Stubs() {
    }

    /** Base: one HTTP server on a free port. */
    abstract static class Stub implements AutoCloseable {
        final HttpServer server;
        final ExecutorService executor = Executors.newCachedThreadPool();

        Stub() {
            try {
                server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
            } catch (IOException ex) {
                throw new IllegalStateException(ex);
            }
            server.createContext("/", exchange -> {
                try {
                    handle(exchange);
                } catch (RuntimeException ex) {
                    send(exchange, 500, "application/json", "{\"error\":\"" + ex.getMessage() + "\"}");
                } finally {
                    exchange.close();
                }
            });
            server.setExecutor(executor);
            server.start();
        }

        String url() {
            return "http://localhost:" + server.getAddress().getPort();
        }

        abstract void handle(HttpExchange exchange) throws IOException;

        static void send(HttpExchange exchange, int status, String contentType, String body) throws IOException {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            if (contentType != null) {
                exchange.getResponseHeaders().add("Content-Type", contentType);
            }
            exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
            if (bytes.length > 0) {
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(bytes);
                }
            }
        }

        static String body(HttpExchange exchange) throws IOException {
            return new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        }

        @Override
        public void close() {
            server.stop(0);
            executor.shutdownNow();
        }
    }

    /**
     * Ollama: {@code /api/tags}, {@code /api/show}, and {@code /api/chat} streaming NDJSON. The chat answer is
     * decided by {@link #script} from the request (default: first ask for a tool, then answer once the tool result is
     * in the messages).
     */
    static final class Ollama extends Stub {

        /** One streamed answer: either tool calls or text chunks. */
        record Reply(List<String> chunks, List<Map<String, Object>> toolCalls, int status) {
            static Reply text(String... chunks) {
                return new Reply(List.of(chunks), List.of(), 200);
            }

            static Reply tool(String name, Map<String, Object> arguments) {
                return new Reply(List.of(), List.of(Map.of("function", Map.of("name", name, "arguments", arguments))),
                        200);
            }

            static Reply error(int status) {
                return new Reply(List.of(), List.of(), status);
            }
        }

        volatile String model = "test-model";
        volatile List<String> capabilities = List.of("completion", "tools");
        volatile Function<JsonNode, Reply> script = request -> Reply.text("Hello.");
        final List<JsonNode> chatRequests = new CopyOnWriteArrayList<>();

        @Override
        void handle(HttpExchange exchange) throws IOException {
            String path = exchange.getRequestURI().getPath();
            switch (path) {
                case "/api/tags" -> send(exchange, 200, "application/json",
                        "{\"models\":[{\"name\":\"" + model + ":latest\",\"model\":\"" + model + ":latest\"}]}");
                case "/api/show" -> send(exchange, 200, "application/json",
                        JSON.writeValueAsString(Map.of("capabilities", capabilities)));
                case "/api/generate" -> send(exchange, 200, "application/json", "{\"done\":true}");
                case "/api/chat" -> chat(exchange);
                default -> send(exchange, 404, "application/json", "{\"error\":\"not found\"}");
            }
        }

        private void chat(HttpExchange exchange) throws IOException {
            JsonNode request = JSON.readTree(body(exchange));
            chatRequests.add(request);
            Reply reply = script.apply(request);
            if (reply.status() != 200) {
                send(exchange, reply.status(), "application/json", "{\"error\":\"model failed\"}");
                return;
            }
            exchange.getResponseHeaders().add("Content-Type", "application/x-ndjson");
            exchange.sendResponseHeaders(200, 0);
            try (OutputStream out = exchange.getResponseBody()) {
                for (String chunk : reply.chunks()) {
                    write(out, Map.of("role", "assistant", "content", chunk), false);
                }
                if (!reply.toolCalls().isEmpty()) {
                    write(out, Map.of("role", "assistant", "content", "", "tool_calls", reply.toolCalls()), false);
                }
                write(out, Map.of("role", "assistant", "content", ""), true);
            }
        }

        private static void write(OutputStream out, Map<String, Object> message, boolean done) throws IOException {
            ObjectNode line = JSON.createObjectNode();
            line.put("model", "test-model");
            line.put("created_at", "2026-11-06T10:00:00Z");
            line.set("message", JSON.valueToTree(message));
            line.put("done", done);
            if (done) {
                line.put("done_reason", "stop");
                line.put("total_duration", 1000);
                line.put("load_duration", 1);
                line.put("prompt_eval_count", 10);
                line.put("prompt_eval_duration", 1);
                line.put("eval_count", 5);
                line.put("eval_duration", 1);
            }
            out.write((JSON.writeValueAsString(line) + "\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        }

        /** The messages of a chat request whose role is "tool". */
        static List<String> toolMessages(JsonNode request) {
            List<String> contents = new ArrayList<>();
            for (JsonNode message : request.path("messages")) {
                if ("tool".equals(message.path("role").asString())) {
                    contents.add(message.path("content").asString());
                }
            }
            return contents;
        }
    }

    /**
     * The MCP server (Streamable HTTP, stateless JSON answers): initialize, tools/list, tools/call. Records the
     * Authorization header and the API key of every request.
     */
    static final class McpServer extends Stub {

        record Call(String method, String authorization, String apiKey, String tool, JsonNode arguments) {
        }

        volatile List<Map<String, Object>> tools = List.of(tool("my_bookings", "Your trips"),
                tool("booking_details", "Booking details"));
        /** (tool name, Authorization header) → result text. */
        volatile BiFunction<String, String, String> results = (tool, authorization) -> "{\"bookings\":[]}";
        volatile int failStatus;
        final List<Call> calls = new CopyOnWriteArrayList<>();

        static Map<String, Object> tool(String name, String title) {
            return Map.of("name", name, "title", title, "description", "Test tool " + name,
                    "inputSchema", Map.of("type", "object", "properties", Map.of()));
        }

        @Override
        void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equals(exchange.getRequestMethod())) {
                send(exchange, 405, null, "");
                return;
            }
            JsonNode request = JSON.readTree(body(exchange));
            String method = request.path("method").asString();
            String authorization = exchange.getRequestHeaders().getFirst("Authorization");
            String apiKey = exchange.getRequestHeaders().getFirst("X-MCP-Api-Key");
            JsonNode params = request.path("params");
            calls.add(new Call(method, authorization, apiKey, params.path("name").asString(null),
                    params.path("arguments")));
            if (failStatus != 0 && !"initialize".equals(method) && !method.startsWith("notifications/")) {
                send(exchange, failStatus, "application/json", "{}");
                return;
            }
            Object result = switch (method) {
                case "initialize" -> Map.of("protocolVersion", params.path("protocolVersion").asString(),
                        "capabilities", Map.of("tools", Map.of()),
                        "serverInfo", Map.of("name", "stub", "version", "1"));
                case "tools/list" -> Map.of("tools", tools);
                case "tools/call" -> Map.of("content", List.of(Map.of("type", "text",
                        "text", results.apply(params.path("name").asString(), authorization))), "isError", false);
                default -> null;
            };
            if (result == null) {
                send(exchange, 202, null, "");
                return;
            }
            send(exchange, 200, "application/json", JSON.writeValueAsString(Map.of("jsonrpc", "2.0",
                    "id", JSON.treeToValue(request.path("id"), Object.class), "result", result)));
        }

        List<Call> toolCalls() {
            return calls.stream().filter(call -> "tools/call".equals(call.method())).toList();
        }
    }

    /** The speech server: /health, /v1/audio/transcriptions (verbose_json), /v1/audio/speech (MP3 bytes). */
    static final class Speech extends Stub {
        volatile String transcript = "what are my upcoming trips";
        volatile double duration = 3.2;
        final List<String> requests = new CopyOnWriteArrayList<>();

        @Override
        void handle(HttpExchange exchange) throws IOException {
            String path = exchange.getRequestURI().getPath();
            String body = body(exchange);
            // Keep the start and the end of large (multipart) bodies: the form fields come after the file part.
            requests.add(path + " " + (body.length() > 900 ? body.substring(0, 300) + body.substring(body.length() - 600)
                    : body));
            switch (path) {
                case "/health" -> send(exchange, 200, "text/plain", "OK");
                case "/v1/audio/transcriptions" -> send(exchange, 200, "application/json",
                        JSON.writeValueAsString(Map.of("text", transcript, "duration", duration, "language", "en")));
                case "/v1/audio/speech" -> {
                    byte[] mp3 = {(byte) 0xFF, (byte) 0xFB, 0x10, 0x00, 1, 2, 3, 4, 5, 6, 7, 8};
                    exchange.getResponseHeaders().add("Content-Type", "audio/mpeg");
                    exchange.sendResponseHeaders(200, mp3.length);
                    try (OutputStream out = exchange.getResponseBody()) {
                        out.write(mp3);
                    }
                }
                default -> send(exchange, 404, null, "");
            }
        }
    }
}
