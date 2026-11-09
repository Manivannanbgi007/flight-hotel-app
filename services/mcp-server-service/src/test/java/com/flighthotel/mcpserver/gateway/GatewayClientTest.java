package com.flighthotel.mcpserver.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;

import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.mcpserver.StubGateway;
import com.flighthotel.mcpserver.StubGateway.Answer;
import com.flighthotel.mcpserver.config.McpServerProperties;
import com.flighthotel.mcpserver.security.Caller;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Calls to the gateway as the user: the token goes along, one retry for idempotent reads, timeouts, breaker. */
class GatewayClientTest {

    private static StubGateway gateway;
    private static final Caller CALLER = new Caller(new AuthenticatedUser(UUID.randomUUID(), "c@example.com",
            Set.of("CUSTOMER"), Set.of(), Instant.now()), "the-users-own-token");

    private GatewayClient client;

    @BeforeAll
    static void start() throws Exception {
        gateway = new StubGateway();
    }

    @AfterAll
    static void stop() {
        gateway.close();
    }

    @BeforeEach
    void setUp() {
        gateway.reset();
        client = client(Duration.ofMillis(800), 3);
    }

    private static GatewayClient client(Duration readTimeout, int failureThreshold) {
        return new GatewayClient(new McpServerProperties("k".repeat(40),
                new McpServerProperties.Gateway(gateway.url(), Duration.ofSeconds(1), readTimeout),
                new McpServerProperties.Breaker(failureThreshold, Duration.ofMinutes(1))),
                JsonMapper.builder().build(), Clock.fixed(Instant.parse("2026-11-06T10:00:00Z"), ZoneOffset.UTC));
    }

    @Test
    void callsTheGatewayWithTheUsersTokenAndEncodedParameters() {
        gateway.on("/api/hotels/sea-breeze", Answer.json("{\"name\":\"Sea Breeze\"}"));
        MDC.put("correlationId", "corr-12345678");
        try {
            JsonNode hotel = client.get(CALLER, "/api/hotels/{slug}", Map.of("slug", "sea-breeze"),
                    Map.of("q", "a b&c=d"));
            assertThat(hotel.path("name").asString()).isEqualTo("Sea Breeze");
        } finally {
            MDC.remove("correlationId");
        }

        StubGateway.Received request = gateway.received().getFirst();
        assertThat(request.authorization()).isEqualTo("Bearer the-users-own-token");
        assertThat(request.correlationId()).isEqualTo("corr-12345678");
        assertThat(request.uri().getRawQuery()).isEqualTo("q=a%20b%26c%3Dd");
    }

    @Test
    void aPathVariableCannotLeaveItsSegment() {
        // The stub looks answers up by the decoded path.
        gateway.on("/api/hotels/../admin", Answer.json("{}"));

        client.get(CALLER, "/api/hotels/{slug}", Map.of("slug", "../admin"), Map.of());

        assertThat(gateway.received().getFirst().uri().getRawPath()).isEqualTo("/api/hotels/..%2Fadmin");
    }

    @Test
    void refusalsAreMappedAndNotRetried() {
        gateway.on("/api/bookings/x", Answer.status(404));

        assertThatThrownBy(() -> client.get(CALLER, "/api/bookings/x", Map.of()))
                .isInstanceOfSatisfying(DownstreamException.class, ex -> {
                    assertThat(ex.kind()).isEqualTo(DownstreamException.Kind.NOT_FOUND_OR_NOT_ALLOWED);
                    assertThat(ex.code()).isEqualTo("STUB_404");
                });
        assertThat(gateway.received()).hasSize(1);
    }

    @Test
    void aBadGatewayIsTriedOnceMore() {
        AtomicInteger calls = new AtomicInteger();
        gateway.on("/api/payments", uri -> calls.incrementAndGet() == 1 ? Answer.status(503)
                : Answer.json("{\"content\":[]}"));

        assertThat(client.get(CALLER, "/api/payments", Map.of()).path("content").isArray()).isTrue();
        assertThat(calls).hasValue(2);
    }

    @Test
    void aTimeoutIsTriedOnceMoreThenReportedAsUnavailable() {
        gateway.on("/api/notifications", new Answer(200, "{}", 2_000));

        long start = System.nanoTime();
        assertThatThrownBy(() -> client.get(CALLER, "/api/notifications", Map.of()))
                .isInstanceOfSatisfying(DownstreamException.class,
                        ex -> assertThat(ex.kind()).isEqualTo(DownstreamException.Kind.UNAVAILABLE));
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofMillis(3_500));
        assertThat(gateway.received()).hasSize(2);
    }

    @Test
    void theBreakerOpensAfterRepeatedFailuresAndFailsFast() {
        GatewayClient fragile = client(Duration.ofMillis(800), 2);
        gateway.on("/api/admin/dashboard", Answer.status(500));

        for (int i = 0; i < 2; i++) {
            assertThatThrownBy(() -> fragile.get(CALLER, "/api/admin/dashboard", Map.of()))
                    .isInstanceOf(DownstreamException.class);
        }
        int calls = gateway.received().size();
        assertThatThrownBy(() -> fragile.get(CALLER, "/api/admin/dashboard", Map.of()))
                .isInstanceOfSatisfying(DownstreamException.class, ex -> assertThat(ex.code()).isEqualTo("CIRCUIT_OPEN"));
        assertThat(gateway.received()).hasSize(calls);

        // Other areas are not affected.
        gateway.on("/api/bookings", Answer.json("{}"));
        assertThat(fragile.get(CALLER, "/api/bookings", Map.of())).isNotNull();
    }

    @Test
    void areasGroupThePaths() {
        assertThat(GatewayClient.area("/api/bookings/{id}/cancellation-quote")).isEqualTo("/api/bookings");
        assertThat(GatewayClient.area("/api/admin/payments")).isEqualTo("/api/admin/payments");
        assertThat(GatewayClient.area("/api/hotel-manager/hotels/{hotelId}/dashboard"))
                .isEqualTo("/api/hotel-manager/hotels");
    }

    @Test
    void theBreakerLetsOneTrialThroughAfterTheOpenPeriod() {
        MutableClock clock = new MutableClock();
        CircuitBreaker breaker = new CircuitBreaker(1, Duration.ofSeconds(30), clock);

        breaker.onFailure();
        assertThat(breaker.tryAcquire()).isFalse();
        clock.now = clock.now.plusSeconds(31);
        assertThat(breaker.tryAcquire()).isTrue();
        assertThat(breaker.tryAcquire()).isFalse();
        breaker.onSuccess();
        assertThat(breaker.state()).isEqualTo(CircuitBreaker.State.CLOSED);
        assertThat(breaker.tryAcquire()).isTrue();
    }

    private static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-11-06T10:00:00Z");

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
