package com.flighthotel.assistant.chat;

import java.time.Duration;

import jakarta.validation.Valid;

import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.assistant.chat.AssistantDtos.ChatRequest;
import com.flighthotel.assistant.chat.AssistantDtos.ConfigResponse;
import com.flighthotel.assistant.chat.AssistantDtos.ConversationResponse;
import com.flighthotel.assistant.config.AssistantProperties;
import com.flighthotel.assistant.memory.ConversationStore;
import com.flighthotel.assistant.status.AssistantStatus;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import reactor.core.publisher.Flux;

/** The assistant's chat API. Every endpoint needs a login; conversations are visible only to their owner. */
@RestController
@RequestMapping("/api/assistant")
@Tag(name = "Assistant", description = "AI assistant: chat (SSE), conversation memory")
public class AssistantController {

    /** SSE comment sent while nothing else happens, so proxies keep the connection open. */
    static final Duration HEARTBEAT = Duration.ofSeconds(15);

    private final ChatService chat;
    private final ConversationStore conversations;
    private final AssistantStatus status;
    private final AssistantProperties properties;

    public AssistantController(ChatService chat, ConversationStore conversations, AssistantStatus status,
            AssistantProperties properties) {
        this.chat = chat;
        this.conversations = conversations;
        this.status = status;
        this.properties = properties;
    }

    @GetMapping("/config")
    @Operation(summary = "Is the assistant available, which model, can the server do speech?")
    public ConfigResponse config() {
        AssistantStatus.Snapshot snapshot = status.current();
        AssistantProperties.Voice voice = properties.voice();
        return new ConfigResponse(snapshot.enabled(), properties.model().name(),
                new AssistantDtos.Voice(snapshot.enabled() && snapshot.transcription(),
                        snapshot.enabled() && snapshot.speech()),
                new AssistantDtos.Limits(properties.chat().maxMessageLength(), voice.maxAudioSize().toBytes(),
                        voice.maxAudioDuration().toSeconds(), voice.maxSpeechChars()));
    }

    @PostMapping(path = "/chat", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(summary = "Ask a question; the answer streams as server-sent events",
            description = "Events: conversation {id}, status {text, tool}, delta {text, replace}, "
                    + "done {messageId, sources, grounded}, error {code, message}. Problems before the stream "
                    + "starts are Problem Details: 400, 404 CONVERSATION_NOT_FOUND, 409 CHAT_IN_PROGRESS, "
                    + "503 ASSISTANT_UNAVAILABLE.")
    public ResponseEntity<Flux<ServerSentEvent<Object>>> chat(@Valid @RequestBody ChatRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        AuthenticatedUser user = CurrentUser.fromJwt(jwt);
        Flux<ChatEvent> events = chat.chat(user, jwt.getTokenValue(), request.conversationId(), request.message());
        Flux<ServerSentEvent<Object>> stream = events
                .map(event -> ServerSentEvent.<Object>builder(event).event(event.name()).build())
                .publish(shared -> Flux.merge(shared, Flux.interval(HEARTBEAT)
                        .map(tick -> ServerSentEvent.<Object>builder().comment("keep-alive").build())
                        .takeUntilOther(shared.then())));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                // nginx: send each event at once instead of buffering the response.
                .header("X-Accel-Buffering", "no")
                .contentType(MediaType.TEXT_EVENT_STREAM)
                .body(stream);
    }

    @GetMapping("/conversations/{id}")
    @Operation(summary = "The messages of one of my conversations (404 for anyone else's or an expired one)")
    public ConversationResponse conversation(@PathVariable String id, @AuthenticationPrincipal Jwt jwt) {
        return ConversationResponse.of(conversations.require(id, CurrentUser.fromJwt(jwt).id()));
    }

    @DeleteMapping("/conversations/{id}")
    @Operation(summary = "Delete one of my conversations")
    public ResponseEntity<Void> delete(@PathVariable String id, @AuthenticationPrincipal Jwt jwt) {
        conversations.delete(id, CurrentUser.fromJwt(jwt).id());
        return ResponseEntity.noContent().build();
    }
}
