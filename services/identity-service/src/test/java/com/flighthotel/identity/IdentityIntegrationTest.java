package com.flighthotel.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;

import com.flighthotel.events.identity.AuthEmailRequested;
import com.jayway.jsonpath.JsonPath;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;
import jakarta.servlet.http.Cookie;

/**
 * Base for identity-service integration tests: the real service against MySQL and Redis (Testcontainers, started
 * once for all test classes). Kafka listeners are off and Schema Registry is mocked; emails are read from the outbox
 * table, which is exactly what Debezium would publish.
 * <p>
 * Every subclass uses the same configuration, so they all share one Spring context.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://identity-it",
        // 32 bytes, base64. Test-only key.
        "travel.security.data-encryption-key=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        "travel.storage.local-root=target/test-storage",
        "identity.demo-users.enabled=true",
        "identity.demo-users.password=" + IdentityIntegrationTest.DEMO_PASSWORD,
        "identity.tokens.refresh-reuse-grace=2s",
        "identity.tokens.email-resend-interval=0s"
})
@AutoConfigureMockMvc
public abstract class IdentityIntegrationTest {

    static final String DEMO_PASSWORD = "DemoPassword2026";
    static final String PASSWORD = "Travel2026Safe";
    static final String ADMIN_EMAIL = "admin@flighthotel.local";
    static final String CUSTOMER_EMAIL = "customer@flighthotel.local";
    static final String MANAGER_EMAIL = "manager@flighthotel.local";
    static final String SUPPORT_EMAIL = "support@flighthotel.local";
    static final String REFRESH_COOKIE = "fh_refresh";

    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.4.13").withDatabaseName("identity_db");
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:8.4.8")).withExposedPorts(6379);

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    static {
        MYSQL.start();
        REDIS.start();
    }

    @DynamicPropertySource
    static void infrastructure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
    }

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected JdbcClient jdbcClient;

    // ------------------------------------------------------------------ accounts

    /** A fresh, unique email per call, so tests never depend on each other. */
    protected static String uniqueEmail(String prefix) {
        return prefix + "-" + SEQUENCE.incrementAndGet() + "-" + UUID.randomUUID().toString().substring(0, 8)
                + "@example.com";
    }

    protected void register(String email, String password) throws Exception {
        mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content("""
                        {"email":"%s","password":"%s","firstName":"Asha","lastName":"Rao","acceptTerms":true}
                        """.formatted(email, password)))
                .andExpect(status().isAccepted());
    }

    /** Registers and verifies an account through the public API; returns the logged-in session. */
    protected Session newCustomer(String prefix) throws Exception {
        String email = uniqueEmail(prefix);
        register(email, PASSWORD);
        verify(lastEmail(email, "VERIFY_EMAIL").getToken());
        return login(email, PASSWORD);
    }

    protected void verify(String token) throws Exception {
        mockMvc.perform(post("/api/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + token + "\"}"))
                .andExpect(status().isOk());
    }

    protected Session login(String email, String password) throws Exception {
        MockHttpServletResponse response = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"%s\",\"password\":\"%s\",\"rememberMe\":true}".formatted(email, password)))
                .andExpect(status().isOk())
                .andReturn().getResponse();
        return Session.from(email, response);
    }

    protected Session admin() throws Exception {
        return login(ADMIN_EMAIL, DEMO_PASSWORD);
    }

    // ------------------------------------------------------------------ requests

    protected static RequestPostProcessor bearer(Session session) {
        return bearer(session.accessToken());
    }

    protected static RequestPostProcessor bearer(String accessToken) {
        return request -> {
            request.addHeader(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken);
            return request;
        };
    }

    /** The anti-CSRF header the browser app sends on cookie-based calls. */
    protected static RequestPostProcessor xhr() {
        return request -> {
            request.addHeader("X-Requested-With", "XMLHttpRequest");
            return request;
        };
    }

    // ------------------------------------------------------------------ emails (from the outbox)

    /** The newest email request of this type for this address, as notification-service would receive it. */
    protected AuthEmailRequested lastEmail(String email, String type) {
        return findLastEmail(email, type)
                .orElseThrow(() -> new AssertionError("No " + type + " email requested for " + email));
    }

    protected Optional<AuthEmailRequested> findLastEmail(String email, String type) {
        List<byte[]> payloads = jdbcClient.sql("""
                        SELECT payload FROM outbox_events WHERE aggregate_type = 'identity-email'
                        ORDER BY created_at DESC, id DESC""")
                .query(byte[].class).list();
        try (KafkaAvroDeserializer deserializer = new KafkaAvroDeserializer()) {
            deserializer.configure(Map.of("schema.registry.url", "mock://identity-it", "specific.avro.reader", true),
                    false);
            return payloads.stream()
                    .map(payload -> (AuthEmailRequested) deserializer.deserialize("identity-email.events", payload))
                    .filter(event -> event.getEmail().equals(email) && event.getEmailType().equals(type))
                    .findFirst();
        }
    }

    protected long countEmails(String email, String type) {
        List<byte[]> payloads = jdbcClient.sql("SELECT payload FROM outbox_events WHERE aggregate_type = 'identity-email'")
                .query(byte[].class).list();
        try (KafkaAvroDeserializer deserializer = new KafkaAvroDeserializer()) {
            deserializer.configure(Map.of("schema.registry.url", "mock://identity-it", "specific.avro.reader", true),
                    false);
            return payloads.stream()
                    .map(payload -> (AuthEmailRequested) deserializer.deserialize("identity-email.events", payload))
                    .filter(event -> event.getEmail().equals(email) && event.getEmailType().equals(type))
                    .count();
        }
    }

    /** A logged-in browser: the access token from the body and the HttpOnly refresh cookie. */
    protected record Session(String email, String accessToken, String userId, Cookie refreshCookie) {

        static Session from(String email, MockHttpServletResponse response) throws Exception {
            String body = response.getContentAsString();
            Cookie cookie = response.getCookie(REFRESH_COOKIE);
            assertThat(cookie).as("refresh cookie").isNotNull();
            return new Session(email, JsonPath.read(body, "$.accessToken"), JsonPath.read(body, "$.user.id"), cookie);
        }

        Session withTokens(String accessToken, Cookie refreshCookie) {
            return new Session(email, accessToken, userId, refreshCookie == null ? this.refreshCookie : refreshCookie);
        }
    }
}
