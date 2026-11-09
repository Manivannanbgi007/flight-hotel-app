package com.flighthotel.mcpserver;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Function;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * A local HTTP server that answers like the API gateway (the pattern of RazorpayPaymentProviderTest): answers are
 * registered per path, every request is recorded with its headers, so a test can check which token arrived.
 */
public final class StubGateway implements AutoCloseable {

    public record Answer(int status, String body, long delayMillis) {
        public static Answer json(String body) {
            return new Answer(200, body, 0);
        }

        public static Answer status(int status) {
            return new Answer(status, "{\"code\":\"STUB_" + status + "\"}", 0);
        }
    }

    public record Received(String method, URI uri, String authorization, String correlationId) {
    }

    private final HttpServer server;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, Function<URI, Answer>> answers = new ConcurrentHashMap<>();
    private final List<Received> received = new CopyOnWriteArrayList<>();

    public StubGateway() throws IOException {
        server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/", this::handle);
        server.setExecutor(executor);
        server.start();
    }

    public String url() {
        return "http://localhost:" + server.getAddress().getPort();
    }

    /** Answers GET {@code path} (exact path, any query). */
    public void on(String path, Answer answer) {
        answers.put(path, uri -> answer);
    }

    public void on(String path, Function<URI, Answer> answer) {
        answers.put(path, answer);
    }

    public List<Received> received() {
        return List.copyOf(received);
    }

    public void reset() {
        answers.clear();
        received.clear();
    }

    private void handle(HttpExchange exchange) throws IOException {
        URI uri = exchange.getRequestURI();
        received.add(new Received(exchange.getRequestMethod(), uri,
                exchange.getRequestHeaders().getFirst("Authorization"),
                exchange.getRequestHeaders().getFirst("X-Correlation-Id")));
        Function<URI, Answer> handler = answers.get(uri.getPath());
        Answer answer = handler == null ? new Answer(404, "{\"code\":\"NOT_FOUND\"}", 0) : handler.apply(uri);
        try {
            if (answer.delayMillis() > 0) {
                Thread.sleep(answer.delayMillis());
            }
            byte[] body = answer.body().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(answer.status(), body.length == 0 ? -1 : body.length);
            if (body.length > 0) {
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(body);
                }
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        } catch (IOException ex) {
            // The client gave up (timeout test).
        } finally {
            exchange.close();
        }
    }

    @Override
    public void close() {
        server.stop(0);
        executor.shutdownNow();
    }
}
