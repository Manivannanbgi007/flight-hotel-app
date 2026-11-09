package com.flighthotel.assistant;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Reads the assistant's server-sent events over real HTTP, like the browser's fetch() reader. */
final class SseClient {

    record Event(String name, JsonNode data) {
    }

    record Result(int status, String contentType, String body, List<Event> events) {

        List<String> names() {
            return events.stream().map(Event::name).toList();
        }

        List<Event> named(String name) {
            return events.stream().filter(event -> event.name().equals(name)).toList();
        }

        /** The answer as the UI would show it (a {@code replace} delta discards what came before). */
        String answer() {
            StringBuilder text = new StringBuilder();
            for (Event event : named("delta")) {
                if (event.data().path("replace").asBoolean()) {
                    text.setLength(0);
                }
                text.append(event.data().path("text").asString());
            }
            return text.toString();
        }

        Event last() {
            return events.getLast();
        }
    }

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private SseClient() {
    }

    static Result post(String url, String token, String json) throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(60))
                .header("Content-Type", "application/json").header("Accept", "text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(json));
        if (token != null) {
            request.header("Authorization", "Bearer " + token);
        }
        // A new client per request: no pooled keep-alive connection that the server may have closed meanwhile.
        HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
        HttpResponse<java.util.stream.Stream<String>> response = http.send(request.build(),
                HttpResponse.BodyHandlers.ofLines());
        String contentType = response.headers().firstValue("Content-Type").orElse("");
        if (!contentType.startsWith("text/event-stream")) {
            return new Result(response.statusCode(), contentType,
                    response.body().collect(Collectors.joining("\n")), List.of());
        }
        List<Event> events = new ArrayList<>();
        String name = null;
        StringBuilder data = new StringBuilder();
        for (String line : (Iterable<String>) response.body()::iterator) {
            if (line.startsWith("event:")) {
                name = line.substring(6).trim();
            } else if (line.startsWith("data:")) {
                data.append(line.substring(5));
            } else if (line.isEmpty() && name != null) {
                events.add(new Event(name, JSON.readTree(data.toString())));
                name = null;
                data.setLength(0);
            }
        }
        return new Result(response.statusCode(), contentType, "", events);
    }
}
