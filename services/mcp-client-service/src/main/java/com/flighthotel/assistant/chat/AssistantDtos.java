package com.flighthotel.assistant.chat;

import java.time.Instant;
import java.util.List;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import com.flighthotel.assistant.blocks.ChatAction;
import com.flighthotel.assistant.blocks.ChatBlock;
import com.flighthotel.assistant.memory.Conversation;

/** Requests and responses of the assistant API (AI_ASSISTANT.md §API). */
public final class AssistantDtos {

    private AssistantDtos() {
    }

    /**
     * @param conversationId continue this conversation (from the {@code conversation} event); empty = a new one
     * @param message        the question, 1–2000 characters
     */
    public record ChatRequest(
            @Pattern(regexp = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                    message = "must be a conversation id") String conversationId,
            @NotBlank @Size(max = 2000) String message) {
    }

    /**
     * @param enabled false = Ollama or the model is not available; the UI hides the chat
     * @param model   the model answering (for the "about" line)
     * @param voice   whether the server can transcribe and speak; false = use the browser's speech APIs
     */
    public record ConfigResponse(boolean enabled, String model, Voice voice, Limits limits) {
    }

    public record Voice(boolean transcription, boolean speech) {
    }

    /** Limits the UI enforces before sending. */
    public record Limits(int maxMessageLength, long maxAudioBytes, long maxAudioSeconds, int maxSpeechChars) {
    }

    public record ConversationResponse(String id, Instant createdAt, Instant updatedAt, List<MessageView> messages) {

        static ConversationResponse of(Conversation conversation) {
            return new ConversationResponse(conversation.id(), conversation.createdAt(), conversation.updatedAt(),
                    conversation.messages().stream().map(MessageView::of).toList());
        }
    }

    /** {@code grounded = false}: the model's answer was replaced by the safe answer. */
    public record MessageView(String id, String role, String text, Instant createdAt,
            List<Conversation.Source> sources, boolean grounded, List<ChatBlock> blocks, List<ChatAction> actions) {

        static MessageView of(Conversation.Message message) {
            return new MessageView(message.id(), message.role(), message.text(), message.createdAt(),
                    message.sources(), !message.replaced(), message.blocks(), message.actions());
        }
    }

    /** @param text 1–1000 characters to read aloud */
    public record SpeechRequest(@NotBlank @Size(max = 1000) String text) {
    }

    public record TranscriptionResponse(String text) {
    }
}
