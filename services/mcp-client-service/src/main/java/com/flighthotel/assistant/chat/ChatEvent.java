package com.flighthotel.assistant.chat;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.flighthotel.assistant.blocks.ChatAction;
import com.flighthotel.assistant.blocks.ChatBlock;
import com.flighthotel.assistant.memory.Conversation;

/**
 * The server-sent events of {@code POST /api/assistant/chat} (event name = {@link #name()}, data = the record as JSON).
 * Order: {@code conversation}, then {@code status} and {@code delta} events, then exactly one {@code done} or
 * {@code error}.
 */
public sealed interface ChatEvent {

    /** The SSE event name (not part of the data). */
    @JsonIgnore
    String name();

    /** First event: the conversation this answer belongs to (new or continued). */
    record ConversationStarted(String id) implements ChatEvent {
        public String name() {
            return "conversation";
        }
    }

    /** Progress for the UI ("Looking up your trips"); {@code tool} is the tool name or null. */
    record Status(String text, String tool) implements ChatEvent {
        public String name() {
            return "status";
        }
    }

    /**
     * More answer text. {@code replace = true} (only after the grounding check failed): discard the text shown so far
     * for this answer and show {@code text} instead.
     */
    record Delta(String text, boolean replace) implements ChatEvent {
        public String name() {
            return "delta";
        }
    }

    /**
     * The cards and buttons of the answer, built by the server from the tool results (never by the model), sent once
     * before {@code done}, and only when there is something to show. Buttons carry route KEYS, not paths.
     */
    record Blocks(List<ChatBlock> blocks, List<ChatAction> actions) implements ChatEvent {
        public String name() {
            return "blocks";
        }
    }

    /** The answer is complete and saved. {@code grounded = false}: the answer was replaced by the safe answer. */
    record Done(String messageId, List<Conversation.Source> sources, boolean grounded) implements ChatEvent {
        public String name() {
            return "done";
        }
    }

    /** The answer failed; {@code message} is safe to show. Last event. */
    record Error(String code, String message) implements ChatEvent {
        public String name() {
            return "error";
        }
    }
}
