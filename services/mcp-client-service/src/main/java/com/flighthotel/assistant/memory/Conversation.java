package com.flighthotel.assistant.memory;

import java.time.Instant;
import java.util.List;

import com.flighthotel.assistant.blocks.ChatAction;
import com.flighthotel.assistant.blocks.ChatBlock;

/**
 * One conversation as stored in Redis (key {@code assistant:conversation:<id>}, deleted 24 h after the last message).
 *
 * @param ownerId      the user who started it; anyone else gets 404
 * @param messages     the last messages, oldest first (at most {@code assistant.memory.max-messages})
 * @param factIds      identifiers seen in this conversation's tool results (grounding check)
 * @param factAmounts  amounts seen in this conversation's tool results (canonical numbers)
 */
public record Conversation(String id, String ownerId, Instant createdAt, Instant updatedAt,
        List<Message> messages, List<String> factIds, List<String> factAmounts) {

    public Conversation {
        messages = messages == null ? List.of() : List.copyOf(messages);
        factIds = factIds == null ? List.of() : List.copyOf(factIds);
        factAmounts = factAmounts == null ? List.of() : List.copyOf(factAmounts);
    }

    /**
     * @param role     {@code user} or {@code assistant}
     * @param sources  the tools an assistant answer used
     * @param replaced the grounding check replaced the model's answer with the safe answer
     * @param blocks   the cards of an assistant answer (built from the tool results); empty for older messages
     * @param actions  the buttons of an assistant answer (route keys only)
     */
    public record Message(String id, String role, String text, Instant createdAt, List<Source> sources,
            boolean replaced, List<ChatBlock> blocks, List<ChatAction> actions) {

        public static final String USER = "user";
        public static final String ASSISTANT = "assistant";

        public Message {
            sources = sources == null ? List.of() : List.copyOf(sources);
            blocks = blocks == null ? List.of() : List.copyOf(blocks);
            actions = actions == null ? List.of() : List.copyOf(actions);
        }

        public Message(String id, String role, String text, Instant createdAt, List<Source> sources,
                boolean replaced) {
            this(id, role, text, createdAt, sources, replaced, List.of(), List.of());
        }
    }

    /** A tool an answer was based on, with a label for people ("Your trips"). */
    public record Source(String tool, String label) {
    }
}
