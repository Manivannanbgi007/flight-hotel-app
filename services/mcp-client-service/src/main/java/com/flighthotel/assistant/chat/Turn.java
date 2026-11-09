package com.flighthotel.assistant.chat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

import com.flighthotel.assistant.blocks.ToolRun;
import com.flighthotel.assistant.grounding.Facts;
import com.flighthotel.assistant.memory.Conversation;

/**
 * The state of one question being answered: whose token the tools use, what the tools returned (facts for the
 * grounding check), which tools were used (the answer's sources), and where status events go. It travels to the tool
 * callbacks in Spring AI's {@code ToolContext}, which is never sent to the model.
 */
public final class Turn {

    /** Key in the {@code ToolContext}. */
    public static final String CONTEXT_KEY = "assistant.turn";

    private final String conversationId;
    private final String accessToken;
    private final String correlationId;
    private final Facts facts;
    private final Consumer<ChatEvent> events;
    private final Map<String, Conversation.Source> sources = new LinkedHashMap<>();
    private final AtomicInteger toolCalls = new AtomicInteger();
    private final List<ToolRun> runs = new ArrayList<>();

    public Turn(String conversationId, String accessToken, String correlationId, Facts facts,
            Consumer<ChatEvent> events) {
        this.conversationId = conversationId;
        this.accessToken = accessToken;
        this.correlationId = correlationId;
        this.facts = facts;
        this.events = events;
    }

    public String conversationId() {
        return conversationId;
    }

    public String accessToken() {
        return accessToken;
    }

    public String correlationId() {
        return correlationId;
    }

    public Facts facts() {
        return facts;
    }

    public void emit(ChatEvent event) {
        events.accept(event);
    }

    public int nextToolCall() {
        return toolCalls.incrementAndGet();
    }

    /** How many tool calls the model made so far (also refused or failed ones). */
    public int toolCallCount() {
        return toolCalls.get();
    }

    /** What a tool returned, for the cards and buttons of the answer. */
    public synchronized void record(ToolRun run) {
        runs.add(run);
    }

    public synchronized List<ToolRun> runs() {
        return new ArrayList<>(runs);
    }

    public synchronized void used(String tool, String label) {
        sources.putIfAbsent(tool, new Conversation.Source(tool, label));
    }

    public synchronized List<Conversation.Source> sources() {
        return new ArrayList<>(sources.values());
    }

    @Override
    public String toString() {
        return "Turn[conversation=" + conversationId + "]";
    }
}
