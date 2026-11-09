package com.flighthotel.assistant.voice;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import com.flighthotel.assistant.config.AssistantProperties;
import com.flighthotel.common.error.ApiException;

import tools.jackson.databind.JsonNode;

/**
 * The local speech server (profile {@code voice}, OpenAI-compatible audio API, e.g. speaches):
 * {@code POST /v1/audio/transcriptions} and {@code POST /v1/audio/speech}. Audio and text are never logged.
 */
@Component
public class SpeechClient {

    private static final Logger log = LoggerFactory.getLogger(SpeechClient.class);

    /** What the speech server heard, and how long the audio was (seconds, if it said). */
    public record Transcript(String text, Double durationSeconds) {
    }

    private final AssistantProperties.Voice settings;
    private final RestClient rest;

    public SpeechClient(AssistantProperties properties) {
        this.settings = properties.voice();
        HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
                .version(HttpClient.Version.HTTP_1_1).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(settings.timeout());
        this.rest = RestClient.builder().requestFactory(factory).build();
    }

    public Transcript transcribe(byte[] audio, AudioFormat format) {
        if (!settings.transcriptionConfigured()) {
            throw unavailable();
        }
        MultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        form.add("file", new ByteArrayResource(audio) {
            @Override
            public String getFilename() {
                return "speech." + format.extension();
            }
        });
        form.add("model", settings.sttModel());
        form.add("response_format", "verbose_json");
        long start = System.nanoTime();
        try {
            JsonNode result = rest.post().uri(url(settings.sttUrl(), "/v1/audio/transcriptions"))
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(form)
                    .retrieve()
                    .body(JsonNode.class);
            log.info("Speech transcribed: bytes={} format={} durationMs={}", audio.length, format,
                    (System.nanoTime() - start) / 1_000_000);
            String text = result == null ? "" : result.path("text").asString("").strip();
            JsonNode duration = result == null ? null : result.get("duration");
            return new Transcript(text, duration != null && duration.isNumber() ? duration.doubleValue() : null);
        } catch (RestClientException ex) {
            log.warn("Speech transcription failed: {}", ex.getClass().getSimpleName());
            throw unavailable();
        }
    }

    public byte[] speak(String text) {
        if (!settings.speechConfigured()) {
            throw unavailable();
        }
        long start = System.nanoTime();
        try {
            byte[] audio = rest.post().uri(url(settings.ttsUrl(), "/v1/audio/speech"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("model", settings.ttsModel(), "voice", settings.ttsVoice(), "input", text,
                            "response_format", "mp3"))
                    .retrieve()
                    .body(byte[].class);
            log.info("Speech generated: chars={} bytes={} durationMs={}", text.length(),
                    audio == null ? 0 : audio.length, (System.nanoTime() - start) / 1_000_000);
            if (audio == null || audio.length == 0) {
                throw unavailable();
            }
            return audio;
        } catch (RestClientException ex) {
            log.warn("Speech generation failed: {}", ex.getClass().getSimpleName());
            throw unavailable();
        }
    }

    private static String url(String base, String path) {
        return base.replaceAll("/+$", "") + path;
    }

    static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "VOICE_UNAVAILABLE",
                "Server speech is not available. Use the browser's speech features instead.");
    }
}
