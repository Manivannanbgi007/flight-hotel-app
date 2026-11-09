package com.flighthotel.notification.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;

import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.Roles;

/**
 * End to end through real infrastructure: a service publishes with {@link RealtimePublisher} → Redis Pub/Sub →
 * realtime hub → SSE stream read by a real HTTP client. Verifies audience filtering and authentication.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://notification-it"
})
@Testcontainers
class RealtimeStreamIntegrationTest {

    @Container
    @ServiceConnection
    static MySQLContainer mysql = new MySQLContainer("mysql:8.4.13").withDatabaseName("notification_db");

    @Container
    @ServiceConnection(name = "redis")
    static GenericContainer<?> redis = new GenericContainer<>(DockerImageName.parse("redis:8.4.8")).withExposedPorts(6379);

    @LocalServerPort
    int port;

    @Autowired
    RealtimePublisher publisher;

    private final HttpClient http = HttpClient.newHttpClient();
    private final List<SseClient> clients = new java.util.ArrayList<>();

    @AfterEach
    void closeStreams() {
        clients.forEach(SseClient::close);
    }

    @Test
    void deliversMessagesOnlyToTheAudience() throws Exception {
        UUID customerId = UUID.randomUUID();
        SseClient customer = open(customerId, Roles.CUSTOMER);
        SseClient admin = open(UUID.randomUUID(), Roles.ADMIN);
        customer.awaitLine(l -> l.equals("event:connected"));
        admin.awaitLine(l -> l.equals("event:connected"));

        publisher.publish(RealtimeMessage.of("booking.status-changed", "BOOKING", "b-1", Map.of("status", "CONFIRMED")),
                RealtimeAudience.user(customerId));

        String data = customer.awaitLine(l -> l.startsWith("data:") && l.contains("booking.status-changed"));
        assertThat(data).contains("\"resourceId\":\"b-1\"").contains("\"status\":\"CONFIRMED\"")
                .doesNotContain("audience");
        assertThat(admin.pollLine(l -> l.contains("booking.status-changed"), Duration.ofSeconds(2))).isNull();

        publisher.publish(RealtimeMessage.of("dashboard.updated", "DASHBOARD", null, Map.of()),
                RealtimeAudience.roles(Roles.ADMIN));

        assertThat(admin.awaitLine(l -> l.contains("dashboard.updated"))).isNotNull();
        assertThat(customer.pollLine(l -> l.contains("dashboard.updated"), Duration.ofSeconds(2))).isNull();
    }

    @Test
    void rejectsStreamsWithoutAValidToken() throws Exception {
        HttpResponse<Void> response = http.send(HttpRequest.newBuilder(streamUri())
                        .header("Accept", "text/event-stream").build(),
                HttpResponse.BodyHandlers.discarding());

        assertThat(response.statusCode()).isEqualTo(401);
    }

    private SseClient open(UUID userId, String role) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(streamUri())
                .header("Accept", "text/event-stream")
                .header("Authorization", "Bearer " + userId + "." + role)
                .build();
        HttpResponse<java.util.stream.Stream<String>> response = http.send(request, HttpResponse.BodyHandlers.ofLines());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Content-Type")).hasValueSatisfying(v -> assertThat(v).startsWith("text/event-stream"));
        SseClient client = new SseClient(response.body());
        clients.add(client);
        return client;
    }

    private URI streamUri() {
        return URI.create("http://localhost:" + port + "/api/realtime/stream");
    }

    /** Reads SSE lines on a background thread so tests can wait for specific lines. */
    static final class SseClient {
        private final BlockingQueue<String> lines = new LinkedBlockingQueue<>();
        private final java.util.stream.Stream<String> stream;
        private final Thread reader;

        SseClient(java.util.stream.Stream<String> stream) {
            this.stream = stream;
            this.reader = Thread.ofVirtual().start(() -> {
                try {
                    stream.forEach(lines::add);
                } catch (RuntimeException ignored) {
                    // stream closed
                }
            });
        }

        String awaitLine(java.util.function.Predicate<String> match) throws InterruptedException {
            String line = pollLine(match, Duration.ofSeconds(10));
            assertThat(line).as("expected SSE line not received").isNotNull();
            return line;
        }

        String pollLine(java.util.function.Predicate<String> match, Duration timeout) throws InterruptedException {
            long deadline = System.nanoTime() + timeout.toNanos();
            while (System.nanoTime() < deadline) {
                String line = lines.poll(Math.max(1, (deadline - System.nanoTime()) / 1_000_000), TimeUnit.MILLISECONDS);
                if (line != null && match.test(line)) {
                    return line;
                }
            }
            return null;
        }

        void close() {
            stream.close();
            reader.interrupt();
        }
    }

    /** Test tokens look like "<userId>.<ROLE>"; real tokens are validated with identity-service's keys. */
    @TestConfiguration
    static class TestJwtConfig {
        @Bean
        @Primary
        JwtDecoder testJwtDecoder() {
            return token -> {
                String[] parts = token.split("\\.");
                if (parts.length != 2) {
                    throw new BadJwtException("invalid test token");
                }
                return Jwt.withTokenValue(token)
                        .header("alg", "none")
                        .subject(parts[0])
                        .claim("roles", List.of(parts[1]))
                        .issuedAt(Instant.now())
                        .expiresAt(Instant.now().plusSeconds(900))
                        .build();
            };
        }
    }
}
