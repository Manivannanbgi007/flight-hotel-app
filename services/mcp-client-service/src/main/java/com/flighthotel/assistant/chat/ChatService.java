package com.flighthotel.assistant.chat;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.ollama.api.OllamaChatOptions;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import com.flighthotel.assistant.blocks.Intent;
import com.flighthotel.assistant.blocks.ResponseAssembler;
import com.flighthotel.assistant.blocks.ToolFirstGate;
import com.flighthotel.assistant.config.AssistantProperties;
import com.flighthotel.assistant.grounding.Facts;
import com.flighthotel.assistant.grounding.StreamingGuard;
import com.flighthotel.assistant.memory.Conversation;
import com.flighthotel.assistant.memory.ConversationStore;
import com.flighthotel.assistant.status.AssistantStatus;
import com.flighthotel.assistant.tools.AssistantToolCallback;
import com.flighthotel.assistant.tools.McpToolGateway;
import com.flighthotel.common.correlation.CorrelationId;
import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.security.AuthenticatedUser;

import io.modelcontextprotocol.spec.McpSchema;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;
import reactor.core.scheduler.Schedulers;
import tools.jackson.databind.json.JsonMapper;

/**
 * Answers one question:
 * <ol>
 * <li>checks (before the stream starts, as Problem Details): the model is available, the conversation is the
 * user's, the user has no other answer in progress;</li>
 * <li>streams the model's answer with the MCP tools of the user's role; tools run with the user's token;</li>
 * <li>releases text only after the grounding check ({@link StreamingGuard}); an invented reference or amount
 * replaces the answer;</li>
 * <li>saves the question and the answer (with its sources and the new facts) in the conversation.</li>
 * </ol>
 * Timeouts: first answer token, pause between tokens, whole answer ({@code assistant.chat.*}). Logs: conversation,
 * role, tools used, timings and outcome; never the question, the answer or tool data.
 */
@Service
public class ChatService {

    private static final Logger log = LoggerFactory.getLogger(ChatService.class);

    private final ChatClient chatClient;
    private final McpToolGateway tools;
    private final ConversationStore conversations;
    private final AssistantStatus status;
    private final AssistantProperties properties;
    private final JsonMapper jsonMapper;
    private final Clock clock;

    public ChatService(ChatClient chatClient, McpToolGateway tools, ConversationStore conversations,
            AssistantStatus status, AssistantProperties properties, JsonMapper jsonMapper, Clock clock) {
        this.chatClient = chatClient;
        this.tools = tools;
        this.conversations = conversations;
        this.status = status;
        this.properties = properties;
        this.jsonMapper = jsonMapper;
        this.clock = clock;
    }

    /** The events of one answer; the checks of step 1 throw before the stream starts. */
    public Flux<ChatEvent> chat(AuthenticatedUser user, String accessToken, String conversationId, String question) {
        AssistantStatus.Snapshot snapshot = status.current();
        if (!snapshot.enabled()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ASSISTANT_UNAVAILABLE",
                    "The assistant is not available right now.");
        }
        String text = clean(question);
        if (text.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "The message is empty.");
        }
        Conversation conversation = conversationId == null ? conversations.create(user.id())
                : conversations.require(conversationId, user.id());
        String lock = conversations.tryLock(user.id()).orElseThrow(() -> new ApiException(HttpStatus.CONFLICT,
                "CHAT_IN_PROGRESS", "Please wait until the current answer is finished."));
        Conversation withQuestion;
        List<Conversation.Message> history = conversation.messages();
        try {
            withQuestion = conversations.append(conversation, new Conversation.Message(UuidV7.generate().toString(),
                    Conversation.Message.USER, text, clock.instant(), List.of(), false), List.of(), List.of());
        } catch (RuntimeException ex) {
            conversations.unlock(user.id(), lock);
            throw ex;
        }
        return answer(user, accessToken, withQuestion, history, text, snapshot.model())
                .doFinally(signal -> conversations.unlock(user.id(), lock));
    }

    private Flux<ChatEvent> answer(AuthenticatedUser user, String accessToken, Conversation conversation,
            List<Conversation.Message> history, String question, AssistantStatus.ModelInfo model) {
        String role = SystemPrompts.primaryRole(user.roles());
        Sinks.Many<ChatEvent> statusEvents = Sinks.many().unicast().onBackpressureBuffer();
        Facts facts = Facts.of(conversation.factIds(), conversation.factAmounts());
        conversation.messages().stream().filter(message -> Conversation.Message.USER.equals(message.role()))
                .forEach(message -> facts.addIdentifiersFromUser(message.text()));
        Turn turn = new Turn(conversation.id(), accessToken, CorrelationId.current(), facts,
                event -> statusEvents.emitNext(event, Sinks.EmitFailureHandler.busyLooping(Duration.ofSeconds(1))));
        StreamingGuard guard = new StreamingGuard(facts);
        // Intent: what the question is about, and whether it needs live data (then a tool must run first).
        boolean afterToolAnswer = history.stream().anyMatch(message -> Conversation.Message.ASSISTANT.equals(message.role())
                && !message.sources().isEmpty());
        boolean needsData = Intent.needsData(role, question, afterToolAnswer);
        log.info("Assistant intent: conversation={} role={} topics={} needsData={} howTo={}", conversation.id(), role,
                Intent.label(Intent.topics(question)), needsData, Intent.howTo(question));
        long start = System.nanoTime();
        AtomicLong firstTokenMs = new AtomicLong(-1);
        AssistantProperties.Chat limits = properties.chat();

        Flux<String> content = Flux.defer(() -> modelStream(user, accessToken, turn, role, history, question, model))
                .subscribeOn(Schedulers.boundedElastic())
                .doOnNext(chunk -> firstTokenMs.compareAndSet(-1, (System.nanoTime() - start) / 1_000_000))
                .timeout(Mono.delay(limits.firstTokenTimeout()), chunk -> Mono.delay(limits.idleTimeout()))
                .transform(flux -> withDeadline(flux, limits.totalTimeout()));

        Flux<ChatEvent> answer = ToolFirstGate.apply(content, needsData, turn::toolCallCount,
                        () -> log.warn("Assistant answered without a lookup, replaced: conversation={} role={}",
                                conversation.id(), role))
                .concatMapIterable(guard::accept)
                .concatWith(Flux.defer(() -> Flux.fromIterable(guard.finish())))
                .map(ChatService::toEvent)
                .takeUntil(event -> event instanceof ChatEvent.Delta delta && delta.replace())
                .concatWith(Flux.defer(() -> blocksEvent(role, user, question, turn)))
                .concatWith(Mono.fromCallable(() -> done(conversation, turn, guard, role, user, question)))
                .doOnComplete(() -> log.info("Assistant answer: conversation={} role={} tools={} grounded={} "
                                + "firstTokenMs={} totalMs={}", conversation.id(), role, turn.sources().size(),
                        !guard.replaced(), firstTokenMs.get(), (System.nanoTime() - start) / 1_000_000))
                .onErrorResume(ex -> Flux.just(failure(ex, conversation.id(), role, start)))
                .doFinally(signal -> statusEvents.tryEmitComplete());

        return Flux.concat(
                Flux.just(new ChatEvent.ConversationStarted(conversation.id()), new ChatEvent.Status("Thinking…", null)),
                Flux.merge(statusEvents.asFlux(), answer));
    }

    private Flux<String> modelStream(AuthenticatedUser user, String accessToken, Turn turn, String role,
            List<Conversation.Message> history, String question, AssistantStatus.ModelInfo model) {
        List<McpSchema.Tool> mcpTools = tools.toolsFor(user, accessToken);
        List<ToolCallback> callbacks = new ArrayList<>();
        for (McpSchema.Tool tool : mcpTools) {
            callbacks.add(new AssistantToolCallback(tool, tools, jsonMapper, properties.chat().maxToolCalls()));
        }
        List<Message> messages = new ArrayList<>();
        messages.add(new SystemMessage(SystemPrompts.forRole(role, LocalDate.now(clock.withZone(
                java.time.ZoneId.of("Asia/Kolkata"))))));
        for (Conversation.Message message : history) {
            messages.add(Conversation.Message.USER.equals(message.role()) ? new UserMessage(message.text())
                    : new AssistantMessage(message.text()));
        }
        messages.add(new UserMessage(question));

        AssistantProperties.Model settings = properties.model();
        OllamaChatOptions.Builder options = OllamaChatOptions.builder()
                .model(settings.name())
                .temperature(settings.temperature())
                .numCtx(settings.numCtx())
                .numPredict(settings.maxAnswerTokens())
                .keepAlive(settings.keepAlive());
        if (model.thinking()) {
            // Hybrid models (qwen3.5, ...) would otherwise "think" for hundreds of tokens before answering.
            options.disableThinking();
        }
        ChatClient.ChatClientRequestSpec request = chatClient.prompt()
                .messages(messages)
                .options(options)
                .toolContext(Map.of(Turn.CONTEXT_KEY, turn));
        if (!callbacks.isEmpty()) {
            request = request.tools(callbacks);
        }
        return request.stream().content();
    }

    /** Fails with a {@link TimeoutException} if the whole answer takes longer than {@code total}. */
    private static <T> Flux<T> withDeadline(Flux<T> flux, Duration total) {
        AtomicBoolean expired = new AtomicBoolean();
        return flux.takeUntilOther(Mono.delay(total).doOnNext(tick -> expired.set(true)))
                .concatWith(Flux.defer(() -> expired.get() ? Flux.error(new TimeoutException("total"))
                        : Flux.empty()));
    }

    /** The cards and buttons of this answer, from the tool results; nothing when there are none. */
    private Flux<ChatEvent> blocksEvent(String role, AuthenticatedUser user, String question, Turn turn) {
        ResponseAssembler.Result result = assemble(role, user, question, turn);
        return result.blocks().isEmpty() && result.actions().isEmpty() ? Flux.empty()
                : Flux.just(new ChatEvent.Blocks(result.blocks(), result.actions()));
    }

    private ResponseAssembler.Result assemble(String role, AuthenticatedUser user, String question, Turn turn) {
        try {
            return ResponseAssembler.assemble(role, user.roles(), question, turn.runs(), turn.facts());
        } catch (RuntimeException ex) {
            log.warn("Assistant cards could not be built: conversation={} error={}", turn.conversationId(),
                    ex.getClass().getSimpleName());
            return new ResponseAssembler.Result(List.of(), List.of());
        }
    }

    private ChatEvent done(Conversation conversation, Turn turn, StreamingGuard guard, String role,
            AuthenticatedUser user, String question) {
        String text = guard.finalText();
        if (text.isBlank()) {
            text = "Sorry, I have no answer to that. Please ask in a different way.";
        }
        ResponseAssembler.Result enrichment = assemble(role, user, question, turn);
        Conversation.Message answer = new Conversation.Message(UuidV7.generate().toString(),
                Conversation.Message.ASSISTANT, text, clock.instant(), turn.sources(), guard.replaced(),
                enrichment.blocks(), enrichment.actions());
        conversations.append(conversation, answer, turn.facts().identifiers(), turn.facts().amounts());
        if (guard.replaced()) {
            log.warn("Assistant answer replaced by the grounding check: conversation={} {}", conversation.id(),
                    guard.violation().map(Object::toString).orElse(""));
        }
        return new ChatEvent.Done(answer.id(), turn.sources(), !guard.replaced());
    }

    private ChatEvent failure(Throwable ex, String conversationId, String role, long start) {
        long totalMs = (System.nanoTime() - start) / 1_000_000;
        ChatEvent.Error error;
        if (ex instanceof McpToolGateway.ToolsUnavailableException) {
            error = new ChatEvent.Error("DATA_UNAVAILABLE",
                    "I can't reach your travel data right now. Please try again in a minute.");
        } else if (ex instanceof TimeoutException) {
            error = new ChatEvent.Error("ASSISTANT_TIMEOUT",
                    "The assistant took too long to answer. Please try again, perhaps with a shorter question.");
        } else if (ex instanceof WebClientRequestException || ex instanceof WebClientResponseException) {
            status.invalidate();
            error = new ChatEvent.Error("ASSISTANT_UNAVAILABLE", "The assistant is not available right now.");
        } else {
            error = new ChatEvent.Error("ASSISTANT_FAILED",
                    "I could not complete that. Please try again or ask in a different way.");
        }
        log.warn("Assistant answer failed: conversation={} role={} code={} error={} totalMs={}", conversationId, role,
                error.code(), ex.getClass().getSimpleName(), totalMs);
        return error;
    }

    private static ChatEvent toEvent(StreamingGuard.Output output) {
        return switch (output) {
            case StreamingGuard.Delta delta -> new ChatEvent.Delta(delta.text(), false);
            case StreamingGuard.Replace replace -> new ChatEvent.Delta(replace.text(), true);
        };
    }

    /** Trims, removes control characters (except line breaks and tabs) and runs of blank lines. */
    static String clean(String text) {
        if (text == null) {
            return "";
        }
        StringBuilder out = new StringBuilder(text.length());
        text.codePoints().forEach(c -> {
            if (c == '\n' || c == '\t' || !Character.isISOControl(c)) {
                out.appendCodePoint(c);
            }
        });
        return out.toString().replaceAll("\n{3,}", "\n\n").strip();
    }
}
