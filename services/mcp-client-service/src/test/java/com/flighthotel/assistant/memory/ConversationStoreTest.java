package com.flighthotel.assistant.memory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

import com.flighthotel.assistant.config.AssistantProperties;
import com.flighthotel.common.error.ApiException;

import tools.jackson.databind.json.JsonMapper;

/** Conversation memory in a real Redis: per owner, 24 h, the last 20 messages, one answer at a time per user. */
class ConversationStoreTest {

    private static final GenericContainer<?> REDIS = new GenericContainer<>(DockerImageName.parse("redis:8.4.8"))
            .withExposedPorts(6379);
    private static LettuceConnectionFactory connections;
    private static StringRedisTemplate redis;
    private static ConversationStore store;

    @BeforeAll
    static void start() {
        REDIS.start();
        connections = new LettuceConnectionFactory(new RedisStandaloneConfiguration(REDIS.getHost(),
                REDIS.getMappedPort(6379)));
        connections.afterPropertiesSet();
        connections.start();
        redis = new StringRedisTemplate(connections);
        AssistantProperties properties = Binder.get(new StandardEnvironment()).bindOrCreate("assistant",
                AssistantProperties.class);
        store = new ConversationStore(redis, JsonMapper.builder().build(), properties, Clock.systemUTC());
    }

    @AfterAll
    static void stop() {
        connections.destroy();
        REDIS.stop();
    }

    private static Conversation.Message message(String role, String text) {
        return new Conversation.Message(UUID.randomUUID().toString(), role, text, Instant.now(),
                List.of(new Conversation.Source("my_bookings", "Your trips")), false);
    }

    @Test
    void onlyTheOwnerFindsAConversation() {
        UUID owner = UUID.randomUUID();
        Conversation conversation = store.append(store.create(owner), message("user", "hi"), List.of(), List.of());

        assertThat(store.find(conversation.id(), owner)).isPresent();
        assertThat(store.find(conversation.id(), UUID.randomUUID())).isEmpty();
        assertThatThrownBy(() -> store.require(conversation.id(), UUID.randomUUID()))
                .isInstanceOfSatisfying(ApiException.class, ex -> {
                    assertThat(ex.getStatus().value()).isEqualTo(404);
                    assertThat(ex.getCode()).isEqualTo("CONVERSATION_NOT_FOUND");
                });
        assertThatThrownBy(() -> store.delete(conversation.id(), UUID.randomUUID())).isInstanceOf(ApiException.class);
        assertThat(store.find(conversation.id(), owner)).isPresent();
        assertThat(store.find("not-a-uuid", owner)).isEmpty();
    }

    @Test
    void conversationsExpireAfter24HoursAndKeepTheLast20Messages() {
        UUID owner = UUID.randomUUID();
        Conversation conversation = store.create(owner);
        for (int i = 1; i <= 25; i++) {
            conversation = store.append(conversation, message(i % 2 == 1 ? "user" : "assistant", "message " + i),
                    List.of("HT-7K3M9Q2X"), List.of(String.valueOf(i)));
        }

        Conversation saved = store.require(conversation.id(), owner);
        assertThat(saved.messages()).hasSize(20);
        assertThat(saved.messages().getFirst().text()).isEqualTo("message 6");
        assertThat(saved.messages().getLast().text()).isEqualTo("message 25");
        assertThat(saved.messages().getLast().sources()).extracting(Conversation.Source::tool)
                .containsExactly("my_bookings");
        assertThat(saved.factIds()).containsExactly("HT-7K3M9Q2X");
        assertThat(saved.factAmounts()).hasSize(25);
        Long ttl = redis.getExpire(ConversationStore.KEY_PREFIX + conversation.id());
        assertThat(ttl).isBetween(Duration.ofHours(24).toSeconds() - 60, Duration.ofHours(24).toSeconds());
    }

    @Test
    void theOwnerCanDeleteIt() {
        UUID owner = UUID.randomUUID();
        Conversation conversation = store.append(store.create(owner), message("user", "hi"), List.of(), List.of());

        store.delete(conversation.id(), owner);

        assertThat(store.find(conversation.id(), owner)).isEmpty();
    }

    @Test
    void oneAnswerAtATimePerUser() {
        UUID user = UUID.randomUUID();
        String token = store.tryLock(user).orElseThrow();

        assertThat(store.tryLock(user)).isEmpty();
        assertThat(store.tryLock(UUID.randomUUID())).isPresent();
        store.unlock(user, "someone-elses-token");
        assertThat(store.tryLock(user)).isEmpty();
        store.unlock(user, token);
        assertThat(store.tryLock(user)).isPresent();
    }
}
