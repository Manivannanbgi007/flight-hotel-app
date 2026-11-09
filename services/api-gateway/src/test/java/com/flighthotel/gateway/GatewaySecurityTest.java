package com.flighthotel.gateway;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * Gateway rules without any backend running: protected routes need a token, CORS only allows configured origins,
 * every response carries a correlation ID. (Redis is not running here either; the rate limiter fails open.)
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "gateway.allowed-origins=http://localhost:5173",
        "spring.data.redis.port=6399"
})
class GatewaySecurityTest {

    @LocalServerPort
    int port;

    WebTestClient client;

    @BeforeEach
    void setUp() {
        client = WebTestClient.bindToServer().baseUrl("http://localhost:" + port).build();
    }

    @Test
    void protectedRoutesRequireAToken() {
        client.get().uri("/api/admin/settings").exchange()
                .expectStatus().isUnauthorized()
                .expectHeader().exists("X-Correlation-Id");

        client.get().uri("/api/bookings").exchange().expectStatus().isUnauthorized();
        client.get().uri("/api/realtime/stream").exchange().expectStatus().isUnauthorized();
    }

    @Test
    void invalidTokensAreRejected() {
        client.get().uri("/api/bookings")
                .header(HttpHeaders.AUTHORIZATION, "Bearer not-a-real-token")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    void corsAllowsOnlyConfiguredOrigins() {
        client.method(HttpMethod.OPTIONS).uri("/api/bookings")
                .header(HttpHeaders.ORIGIN, "http://localhost:5173")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "authorization,idempotency-key")
                .exchange()
                .expectStatus().isOk()
                .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:5173")
                .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS, "true");

        client.method(HttpMethod.OPTIONS).uri("/api/bookings")
                .header(HttpHeaders.ORIGIN, "https://evil.example")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    void unsafeCorrelationIdsAreReplaced() {
        client.get().uri("/api/admin/settings")
                .header("X-Correlation-Id", "<script>alert(1)</script> fake-log-entry")
                .exchange()
                .expectHeader().value("X-Correlation-Id",
                        value -> org.assertj.core.api.Assertions.assertThat(value).matches("[0-9a-f-]{36}"));
    }

    @Test
    void safeCorrelationIdsAreKept() {
        client.get().uri("/api/admin/settings")
                .header("X-Correlation-Id", "frontend-trace-12345")
                .exchange()
                .expectHeader().valueEquals("X-Correlation-Id", "frontend-trace-12345");
    }
}
