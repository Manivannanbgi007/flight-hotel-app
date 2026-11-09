package com.flighthotel.assistant.memory;

import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.flighthotel.assistant.config.AssistantProperties;
import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.id.UuidV7;

import tools.jackson.databind.json.JsonMapper;

/**
 * Conversation memory in Redis: per user and conversation, forgotten {@code assistant.memory.ttl} (24 h) after the
 * last message, at most {@code assistant.memory.max-messages} (20) messages. Someone else's conversation is
 * answered exactly like a missing one ({@code 404 CONVERSATION_NOT_FOUND}).
 * <p>
 * A user has at most one answer in progress ({@link #tryLock}): a second chat request at the same time gets
 * {@code 409 CHAT_IN_PROGRESS}. The CPU-only model answers one question at a time anyway.
 */
@Component
public class ConversationStore {

    private static final Logger log = LoggerFactory.getLogger(ConversationStore.class);
    static final String KEY_PREFIX = "assistant:conversation:";
    static final String LOCK_PREFIX = "assistant:chat-lock:";
    private static final int MAX_FACTS = 2000;
    private static final DefaultRedisScript<Long> UNLOCK = new DefaultRedisScript<>(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            Long.class);

    private final StringRedisTemplate redis;
    private final JsonMapper jsonMapper;
    private final AssistantProperties.Memory settings;
    private final Duration lockTtl;
    private final Clock clock;

    public ConversationStore(StringRedisTemplate redis, JsonMapper jsonMapper, AssistantProperties properties,
            Clock clock) {
        this.redis = redis;
        this.jsonMapper = jsonMapper;
        this.settings = properties.memory();
        this.lockTtl = properties.chat().totalTimeout().plusSeconds(30);
        this.clock = clock;
    }

    /** The user's conversation, or 404 (also when it belongs to someone else). */
    public Conversation require(String conversationId, UUID userId) {
        return find(conversationId, userId).orElseThrow(ConversationStore::notFound);
    }

    public Optional<Conversation> find(String conversationId, UUID userId) {
        if (conversationId == null || !conversationId.matches("[0-9a-f-]{36}")) {
            return Optional.empty();
        }
        String json = redis.opsForValue().get(KEY_PREFIX + conversationId);
        if (json == null) {
            return Optional.empty();
        }
        Conversation conversation = jsonMapper.readValue(json, Conversation.class);
        if (!userId.toString().equals(conversation.ownerId())) {
            log.info("Conversation access refused: not the owner");
            return Optional.empty();
        }
        return Optional.of(conversation);
    }

    public Conversation create(UUID userId) {
        var now = clock.instant();
        return new Conversation(UuidV7.generate().toString(), userId.toString(), now, now, List.of(), List.of(),
                List.of());
    }

    /** Adds a message (keeping the last N) and new facts, and restarts the expiry. */
    public Conversation append(Conversation conversation, Conversation.Message message, Collection<String> factIds,
            Collection<String> factAmounts) {
        List<Conversation.Message> messages = new ArrayList<>(conversation.messages());
        messages.add(message);
        if (messages.size() > settings.maxMessages()) {
            messages = new ArrayList<>(messages.subList(messages.size() - settings.maxMessages(), messages.size()));
        }
        Conversation updated = new Conversation(conversation.id(), conversation.ownerId(), conversation.createdAt(),
                clock.instant(), messages, merge(conversation.factIds(), factIds),
                merge(conversation.factAmounts(), factAmounts));
        redis.opsForValue().set(KEY_PREFIX + updated.id(), jsonMapper.writeValueAsString(updated), settings.ttl());
        return updated;
    }

    /** Deletes the user's conversation; 404 if there is none (or it is someone else's). */
    public void delete(String conversationId, UUID userId) {
        require(conversationId, userId);
        redis.delete(KEY_PREFIX + conversationId);
    }

    /** @return a token to {@link #unlock} with, or empty if the user already has an answer in progress */
    public Optional<String> tryLock(UUID userId) {
        String token = UUID.randomUUID().toString();
        Boolean acquired = redis.opsForValue().setIfAbsent(LOCK_PREFIX + userId, token, lockTtl);
        return Boolean.TRUE.equals(acquired) ? Optional.of(token) : Optional.empty();
    }

    public void unlock(UUID userId, String token) {
        try {
            redis.execute(UNLOCK, List.of(LOCK_PREFIX + userId), token);
        } catch (RuntimeException ex) {
            // The lock expires by itself.
            log.warn("Could not release the chat lock: {}", ex.getClass().getSimpleName());
        }
    }

    private static List<String> merge(List<String> existing, Collection<String> added) {
        Set<String> merged = new LinkedHashSet<>(existing);
        if (added != null) {
            merged.addAll(added);
        }
        List<String> list = new ArrayList<>(merged);
        return list.size() <= MAX_FACTS ? list : list.subList(list.size() - MAX_FACTS, list.size());
    }

    static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND",
                "This conversation does not exist or has expired.");
    }
}
