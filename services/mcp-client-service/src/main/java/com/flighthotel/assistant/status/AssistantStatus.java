package com.flighthotel.assistant.status;

import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import com.flighthotel.assistant.config.AssistantProperties;

import tools.jackson.databind.JsonNode;

/**
 * Is the assistant usable right now? {@code GET /api/assistant/config} answers {@code enabled = false} (and the
 * frontend hides the chat) when Ollama cannot be reached, the model has not been pulled, or the model cannot call
 * tools. The voice flags say whether the speech server answers. Results are cached for
 * {@code assistant.chat.status-cache-ttl}; a failed chat request clears the cache.
 */
@Component
public class AssistantStatus {

    private static final Logger log = LoggerFactory.getLogger(AssistantStatus.class);
    private static final Duration CHECK_TIMEOUT = Duration.ofSeconds(3);

    /** What the model can do (Ollama {@code /api/show} capabilities). */
    public record ModelInfo(boolean available, boolean tools, boolean thinking, String reason) {
        static ModelInfo unavailable(String reason) {
            return new ModelInfo(false, false, false, reason);
        }
    }

    public record Snapshot(ModelInfo model, boolean transcription, boolean speech, Instant checkedAt) {
        public boolean enabled() {
            return model.available() && model.tools();
        }
    }

    private final AssistantProperties properties;
    private final RestClient ollama;
    private final RestClient voice;
    private final Clock clock;
    private final java.util.concurrent.atomic.AtomicBoolean warmUpStarted = new java.util.concurrent.atomic.AtomicBoolean();
    private volatile Snapshot cached;

    public AssistantStatus(AssistantProperties properties, Clock clock) {
        this.properties = properties;
        this.clock = clock;
        this.ollama = client(properties.model().baseUrl());
        this.voice = client(null);
    }

    private static RestClient client(String baseUrl) {
        HttpClient http = HttpClient.newBuilder().connectTimeout(CHECK_TIMEOUT)
                .version(HttpClient.Version.HTTP_1_1).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(CHECK_TIMEOUT);
        RestClient.Builder builder = RestClient.builder().requestFactory(factory);
        if (baseUrl != null) {
            builder.baseUrl(baseUrl);
        }
        return builder.build();
    }

    public Snapshot current() {
        Snapshot snapshot = cached;
        if (snapshot != null && snapshot.checkedAt().plus(properties.chat().statusCacheTtl()).isAfter(clock.instant())) {
            return snapshot;
        }
        snapshot = new Snapshot(checkModel(), checkVoice(properties.voice().transcriptionConfigured(),
                properties.voice().sttUrl()), checkVoice(properties.voice().speechConfigured(),
                properties.voice().ttsUrl()), clock.instant());
        if (cached == null || cached.enabled() != snapshot.enabled()) {
            log.info("Assistant status: enabled={} model={} reason={} transcription={} speech={}", snapshot.enabled(),
                    properties.model().name(), snapshot.model().reason(), snapshot.transcription(), snapshot.speech());
        }
        cached = snapshot;
        return snapshot;
    }

    /** Forget the cached result (after a failed chat, so the next config call checks again). */
    public void invalidate() {
        cached = null;
    }

    private ModelInfo checkModel() {
        String model = properties.model().name();
        try {
            JsonNode tags = ollama.get().uri("/api/tags").retrieve().body(JsonNode.class);
            Set<String> names = new HashSet<>();
            if (tags != null) {
                for (JsonNode entry : tags.path("models")) {
                    names.add(entry.path("name").asString(""));
                    names.add(entry.path("model").asString(""));
                }
            }
            if (!names.contains(model) && !names.contains(model + ":latest")) {
                return ModelInfo.unavailable("model " + model + " is not pulled yet");
            }
            JsonNode show = ollama.post().uri("/api/show").contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("model", model)).retrieve().body(JsonNode.class);
            Set<String> capabilities = new HashSet<>();
            if (show != null) {
                for (JsonNode capability : show.path("capabilities")) {
                    capabilities.add(capability.asString(""));
                }
            }
            boolean tools = capabilities.contains("tools");
            return new ModelInfo(true, tools, capabilities.contains("thinking"),
                    tools ? "ok" : "model " + model + " cannot call tools");
        } catch (RuntimeException ex) {
            return ModelInfo.unavailable("Ollama unreachable (" + ex.getClass().getSimpleName() + ")");
        }
    }

    private boolean checkVoice(boolean configured, String baseUrl) {
        if (!configured) {
            return false;
        }
        try {
            voice.get().uri(baseUrl.replaceAll("/+$", "") + "/health").retrieve().toBodilessEntity();
            return true;
        } catch (RuntimeException ex) {
            return false;
        }
    }

    /** Loads the model into memory once the service is up, so the first question does not wait for it. */
    @EventListener(ApplicationReadyEvent.class)
    public void warmUp() {
        if (!properties.model().warmUp() || !warmUpStarted.compareAndSet(false, true)) {
            return;
        }
        Thread.ofVirtual().name("assistant-warm-up").start(() -> {
            try {
                if (!current().enabled()) {
                    return;
                }
                RestClient slow = RestClient.builder().baseUrl(properties.model().baseUrl())
                        .requestFactory(new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                                .connectTimeout(CHECK_TIMEOUT).version(HttpClient.Version.HTTP_1_1).build()))
                        .build();
                long start = System.nanoTime();
                slow.post().uri("/api/generate").contentType(MediaType.APPLICATION_JSON)
                        .body(Map.of("model", properties.model().name(), "keep_alive", properties.model().keepAlive(),
                                "options", Map.of("num_ctx", properties.model().numCtx())))
                        .retrieve().toBodilessEntity();
                log.info("Assistant model loaded: model={} durationMs={}", properties.model().name(),
                        (System.nanoTime() - start) / 1_000_000);
            } catch (RuntimeException ex) {
                log.warn("Assistant model warm-up failed: {}", ex.getClass().getSimpleName());
            }
        });
    }
}
