package com.flighthotel.notification.messaging;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;

import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.identity.AuthEmailRequested;
import com.jayway.jsonpath.JsonPath;

/**
 * Account emails end to end: an {@code identity-email.events} record → listener → real SMTP server (Mailpit) →
 * read back through Mailpit's API. Also checks idempotency and the expired-link rule.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://notification-email-it",
        "notification.email.app-public-url=https://app.example.test"
})
@Testcontainers
class AccountEmailIntegrationTest {

    @Container
    @ServiceConnection
    static MySQLContainer mysql = new MySQLContainer("mysql:8.4.13").withDatabaseName("notification_db");

    @Container
    @ServiceConnection(name = "redis")
    static GenericContainer<?> redis = new GenericContainer<>(DockerImageName.parse("redis:8.4.8")).withExposedPorts(6379);

    @Container
    static GenericContainer<?> mailpit = new GenericContainer<>(DockerImageName.parse("axllent/mailpit:v1.33.0"))
            .withExposedPorts(1025, 8025);

    @DynamicPropertySource
    static void mail(DynamicPropertyRegistry registry) {
        registry.add("spring.mail.host", mailpit::getHost);
        registry.add("spring.mail.port", () -> mailpit.getMappedPort(1025));
    }

    @Autowired
    AccountEmailListener listener;

    @Autowired
    JdbcClient jdbcClient;

    private final HttpClient http = HttpClient.newHttpClient();

    @Test
    void verificationEmailIsDeliveredAndLogged() throws Exception {
        String to = "asha-" + UUID.randomUUID() + "@example.com";
        String eventId = UUID.randomUUID().toString();

        listener.onEmailRequested(record(eventId, request(to, "VERIFY_EMAIL", "tok_ABC-123", Duration.ofHours(24))));

        List<String> ids = messageIdsTo(to);
        assertThat(ids).hasSize(1);
        String message = get("/api/v1/message/" + ids.get(0));
        assertThat((String) JsonPath.read(message, "$.Subject")).isEqualTo("Verify your email address");
        assertThat((String) JsonPath.read(message, "$.From.Address")).isEqualTo("no-reply@flighthotel.local");
        assertThat((String) JsonPath.read(message, "$.HTML"))
                .contains("https://app.example.test/verify-email?token=tok_ABC-123")
                .contains("&lt;b&gt;Asha&lt;/b&gt;");
        assertThat((String) JsonPath.read(message, "$.Text"))
                .contains("Verify email: https://app.example.test/verify-email?token=tok_ABC-123");

        assertThat(jdbcClient.sql("SELECT status FROM email_messages WHERE source_event_id = :id")
                .param("id", eventId).query(String.class).single()).isEqualTo("SENT");
    }

    @Test
    void theSameEventIsSentOnlyOnce() throws Exception {
        String to = "dup-" + UUID.randomUUID() + "@example.com";
        ConsumerRecord<String, Object> record = record(UUID.randomUUID().toString(), request(to, "WELCOME", null, null));

        listener.onEmailRequested(record);
        listener.onEmailRequested(record);

        assertThat(messageIdsTo(to)).hasSize(1);
    }

    @Test
    void expiredLinksAreNotSent() throws Exception {
        String to = "late-" + UUID.randomUUID() + "@example.com";
        String eventId = UUID.randomUUID().toString();
        AuthEmailRequested request = request(to, "RESET_PASSWORD", "tok_old", Duration.ofHours(1));
        request.setRequestedAt(Instant.now().minus(Duration.ofHours(2)));
        request.setExpiresAt(Instant.now().minus(Duration.ofHours(1)));

        listener.onEmailRequested(record(eventId, request));

        assertThat(messageIdsTo(to)).isEmpty();
        assertThat(jdbcClient.sql("SELECT status FROM email_messages WHERE source_event_id = :id")
                .param("id", eventId).query(String.class).single()).isEqualTo("SKIPPED_EXPIRED");
    }

    private List<String> messageIdsTo(String address) throws Exception {
        return JsonPath.read(get("/api/v1/messages?limit=200"), "$.messages[?(@.To[0].Address == '" + address + "')].ID");
    }

    private String get(String path) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(
                URI.create("http://" + mailpit.getHost() + ":" + mailpit.getMappedPort(8025) + path)).build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return response.body();
    }

    private static AuthEmailRequested request(String to, String type, String token, Duration validity) {
        Instant now = Instant.now();
        return AuthEmailRequested.newBuilder()
                .setUserId(UUID.randomUUID().toString())
                .setEmail(to)
                .setFirstName("<b>Asha</b>")
                .setEmailType(type)
                .setToken(token)
                .setExpiresAt(validity == null ? null : now.plus(validity))
                .setRequestedAt(now)
                .build();
    }

    private static ConsumerRecord<String, Object> record(String eventId, AuthEmailRequested request) {
        ConsumerRecord<String, Object> record = new ConsumerRecord<>(AccountEmailListener.TOPIC, 0, 0L,
                request.getUserId(), request);
        record.headers().add(EventHeaders.EVENT_ID, eventId.getBytes(StandardCharsets.UTF_8));
        record.headers().add(EventHeaders.EVENT_TYPE, AuthEmailRequested.class.getName().getBytes(StandardCharsets.UTF_8));
        return record;
    }
}
